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
            <img src="/sqs-logo.svg" alt="Sequoia Quality Solutions" className="h-20 w-20 mx-auto mb-4" />
            <h1 className="text-2xl font-bold tracking-wide" style={{ fontFamily: 'Montserrat, sans-serif' }}>
              SEQUOIA QUALITY SOLUTIONS
            </h1>
            <p className="text-sm text-primary font-medium mt-1">Field Service Tracker</p>
            <p className="text-xs text-base-content/40 mt-2">Sign in to continue</p>
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

          <p className="text-center text-xs text-base-content/30 mt-4">
            © {new Date().getFullYear()} Sequoia Quality Solutions
          </p>
        </div>
      </div>
    </div>
  );
};
