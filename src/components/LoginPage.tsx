import React, { useState } from 'react';
import { LogIn } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface LoginPageProps {
  onLogin: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    onLogin();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-base-300 p-4">
      {/* Diagonal stripe background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-5">
        <div className="absolute -top-1/2 -right-1/4 w-full h-[200%] rotate-[25deg]"
          style={{ background: 'linear-gradient(180deg, #6c5f14 0%, #935f10 30%, #d17609 60%, #f27c22 100%)' }}
        />
      </div>

      <div className="card bg-base-100 w-full max-w-md shadow-2xl border border-primary/20 relative z-10">
        <div className="card-body">
          <div className="text-center mb-6">
            <img src="/spcs-logo.png" alt="Scientific Pest Control Services" className="h-28 mx-auto mb-3" />
            <h1 className="text-xl font-black tracking-wider text-base-content" style={{ fontFamily: "'Waukegan LDO Black', 'Arial Black', sans-serif" }}>
              SCIENTIFIC PEST CONTROL SERVICES
            </h1>
            <p className="text-xs italic text-base-content/60 mt-1" style={{ fontFamily: 'Arial, sans-serif' }}>
              Specialists in Food, Pharmaceutical Packaging Industries and Fumigation
            </p>
            <div className="divider my-2"></div>
            <p className="text-sm text-primary font-medium">Field Service Time Tracker</p>
            <p className="text-xs text-base-content/40 mt-1">Sign in to continue</p>
          </div>

          {error && (
            <div className="alert alert-error py-2 text-sm">
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="form-control">
              <label className="label"><span className="label-text font-medium">Email</span></label>
              <input
                type="email"
                className="input input-bordered w-full focus:border-primary"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text font-medium">Password</span></label>
              <input
                type="password"
                className="input input-bordered w-full focus:border-primary"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className={`btn btn-primary w-full font-semibold text-base ${loading ? 'loading' : ''}`}
              disabled={loading}
            >
              <LogIn size={18} />
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="text-center mt-4 space-y-1">
            <p className="text-xs text-base-content/30">
              Powered by <img src="/sqs-logo.svg" alt="SQS" className="inline h-4 align-middle" /> <strong>Sequoia Quality Solutions</strong>
            </p>
            <p className="text-xs text-base-content/20">
              © {new Date().getFullYear()} Sequoia Quality Solutions™ · Field Service Time Tracker™
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
