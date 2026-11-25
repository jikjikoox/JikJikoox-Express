import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

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
        <div className="min-h-screen bg-[#F6F7F6] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-[#E4EAE6] rounded-2xl p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-[#FDF0F0] text-[#C82829] flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-bold text-[#111915] mb-2">
              Interruption momentanée
            </h1>
            <p className="text-sm text-[#586860] mb-6 leading-relaxed">{friendly}</p>
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-[#0F6B3E] hover:bg-[#0A5230] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              Recharger l’application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
