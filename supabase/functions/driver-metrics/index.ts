/**
 * Statistiques personnelles du livreur : livraisons, zones et distance GPS estimée.
 * Les kilomètres sont calculés uniquement à partir des points GPS captés pendant
 * les missions actives; ils sont indicatifs et filtrés sur la précision/vitesse.
 */
import { buildCorsHeaders, errorResponse, jsonResponse } from '../_shared/corsAndResponse.ts';
import { extractBearerToken, FirebaseAuthError, verifyFirebaseIdToken } from '../_shared/firebaseAuth.ts';
import { assertAuthorizedActiveDriver, DriverAuthorizationError, fetchDriverByFirebaseUid, readDenoEnv, supabaseRest } from '../_shared/supabaseAdmin.ts';

const rad=(n:number)=>n*Math.PI/180;
function haversine(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){
 const R=6371, dLat=rad(b.latitude-a.latitude),dLon=rad(b.longitude-a.longitude);
 const x=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;
 return 2*R*Math.asin(Math.sqrt(Math.min(1,x)));
}
export async function handleDriverMetrics(req:Request):Promise<Response>{
 const env=readDenoEnv(),cors=buildCorsHeaders(req.headers.get('origin'),env.allowedOrigins);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='GET')return errorResponse('METHOD_NOT_ALLOWED','Méthode non autorisée.',405,cors);
 try{
  const token=extractBearerToken(req.headers.get('authorization'));
  const user=await verifyFirebaseIdToken(token,{projectId:env.firebaseProjectId});
  const driver=assertAuthorizedActiveDriver(await fetchDriverByFirebaseUid(env,user.uid));
  const deliveries=await supabaseRest<any[]>(env,`/rest/v1/express_deliveries?driver_id=eq.${encodeURIComponent(driver.id)}&status=eq.DELIVERED&select=id,order_number,delivery_zone,estimated_fee,created_at,updated_at&order=updated_at.desc&limit=1000`);
  if(!deliveries.ok||!Array.isArray(deliveries.data))return errorResponse('METRICS_DELIVERIES_FAILED','Historique de courses indisponible.',500,cors);
  const ids=deliveries.data.map(d=>String(d.id));
  let locations:any[]=[];
  if(ids.length){
   const inList=ids.map(id=>encodeURIComponent(id)).join(',');
   const gps=await supabaseRest<any[]>(env,`/rest/v1/express_driver_locations?driver_id=eq.${encodeURIComponent(driver.id)}&delivery_id=in.(${inList})&select=delivery_id,latitude,longitude,accuracy_meters,speed_mps,recorded_at&order=recorded_at.asc&limit=10000`);
   if(gps.ok&&Array.isArray(gps.data))locations=gps.data;
  }
  const grouped=new Map<string,any[]>();
  for(const point of locations){
   if(typeof point.latitude!=='number'||typeof point.longitude!=='number'||(point.accuracy_meters!=null&&point.accuracy_meters>100))continue;
   const key=String(point.delivery_id);const arr=grouped.get(key)||[];arr.push(point);grouped.set(key,arr);
  }
  const kmByDelivery=new Map<string,number>();
  for(const [id,points] of grouped){
   let km=0;
   for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    const gap=(Date.parse(b.recorded_at)-Date.parse(a.recorded_at))/1000;
    if(!Number.isFinite(gap)||gap<=0||gap>300)continue;
    const segment=haversine(a,b);
    if(segment>0.5||(segment*1000/gap)>45)continue;
    km+=segment;
   }
   kmByDelivery.set(id,Number(km.toFixed(2)));
  }
  const zones=new Map<string,{zone:string;deliveries:number;fees:number;distanceKm:number}>();
  const trips=deliveries.data.map(d=>{
   const zone=String(d.delivery_zone||'Zone non renseignée');
   const fee=Number(d.estimated_fee||0),distanceKm=kmByDelivery.get(String(d.id))||0;
   const item=zones.get(zone)||{zone,deliveries:0,fees:0,distanceKm:0};
   item.deliveries++;item.fees+=fee;item.distanceKm+=distanceKm;zones.set(zone,item);
   return {deliveryId:String(d.id),orderNumber:String(d.order_number||d.id),zone,fee,distanceKm,completedAt:d.updated_at||d.created_at||null};
  });
  const totalKm=trips.reduce((s,t)=>s+t.distanceKm,0);
  return jsonResponse({ok:true,generatedAt:new Date().toISOString(),deliveredCount:trips.length,totalFees:trips.reduce((s,t)=>s+t.fee,0),gpsDistanceKm:Number(totalKm.toFixed(2)),gpsCoverageCount:trips.filter(t=>t.distanceKm>0).length,zones:[...zones.values()].map(z=>({...z,distanceKm:Number(z.distanceKm.toFixed(2))})).sort((a,b)=>b.deliveries-a.deliveries),trips},200,cors);
 }catch(err){
  if(err instanceof FirebaseAuthError||err instanceof DriverAuthorizationError)return errorResponse(err.code,err.message,err.httpStatus,cors);
  return errorResponse('INTERNAL_ERROR','Impossible de calculer les statistiques livreur.',500,cors);
 }
}
const denoRuntime=(globalThis as unknown as {Deno?:{serve(fn:(r:Request)=>Promise<Response>):void}}).Deno;
if(denoRuntime?.serve)denoRuntime.serve(handleDriverMetrics);
