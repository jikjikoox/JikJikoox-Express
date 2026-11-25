import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { BrandAccentBar, BrandLogo } from './BrandLogo';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Une erreur inattendue est survenue.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('JikJikoox Express ErrorBoundary:', error);
  }

  handleReload = () => {
    this.setState({ hasError: false, message: '' });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      let friendly = 'Une interruption de service ou de permissions s’est produite.';
      if (this.state.message.includes('Missing or insufficient permissions')) {
        friendly =
          'Accès refusé par les règles de sécurité Firestore. Vérifiez que votre compte livreur est actif et connecté.';
      }

      return (
        <div className="min-h-screen bg-[#F7F6F2] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-[#E5E2D9] rounded-2xl overflow-hidden text-center shadow-2xs">
            <BrandAccentBar />
            <div className="p-6">
              <div className="flex justify-center mb-5">
                <BrandLogo size="md" showWordmark />
              </div>
              <div className="w-12 h-12 rounded-xl bg-[#FDF0EE] text-[#C6241B] flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6" aria-hidden="true" />
              </div>
              <h1 className="text-lg font-bold text-[#141413] mb-2">
                Interruption momentanée
              </h1>
              <p className="text-sm text-[#5A5851] mb-6 leading-relaxed">{friendly}</p>
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                Recharger l’application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
