import React from 'react';

export const PortalLanding: React.FC = () => {
  return (
    <div className="min-h-screen bg-base-300 relative overflow-hidden flex flex-col">
      {/* Diagonal stripe background effect */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, transparent 40%, rgba(242,124,34,0.06) 40%, rgba(242,124,34,0.06) 60%, transparent 60%)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, transparent 35%, rgba(242,124,34,0.03) 35%, rgba(242,124,34,0.03) 45%, transparent 45%)',
        }}
      />

      {/* Top header bar */}
      <header className="relative z-10 flex items-center justify-between px-4 sm:px-8 py-3 bg-base-200/80 backdrop-blur border-b border-base-content/10">
        <div className="flex items-center gap-3">
          <img src="/sqs-logo.svg" alt="SQS" className="h-8 w-8" />
          <span className="text-sm sm:text-base font-bold text-primary tracking-wide" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            SEQUOIA QUALITY SOLUTIONS
          </span>
        </div>
        <span className="text-xs sm:text-sm text-base-content/60 font-medium hidden sm:block">
          Field Service Time Tracker™
        </span>
      </header>

      {/* Center content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
        <div className="bg-base-100 border border-base-content/10 rounded-2xl shadow-2xl p-8 sm:p-12 max-w-md w-full text-center">
          {/* Logo */}
          <div className="flex justify-center mb-5">
            <img src="/sqs-logo.svg" alt="Sequoia Quality Solutions" className="h-20 w-20" />
          </div>

          {/* Brand text */}
          <h1
            className="text-2xl font-bold text-primary tracking-wide mb-1"
            style={{ fontFamily: 'Montserrat, sans-serif' }}
          >
            SEQUOIA QUALITY SOLUTIONS
          </h1>
          <h2 className="text-xl font-semibold text-base-content mb-1">
            Field Service Time Tracker™
          </h2>
          <p className="text-sm text-base-content/50 mb-4">Application Portal</p>

          {/* Primary divider */}
          <div className="mx-auto max-w-xs h-px bg-primary/40 mb-5" />

          {/* Tagline */}
          <p className="text-sm text-base-content/50 italic mb-6 leading-relaxed px-2">
            GPS-enabled workforce management for field service teams.
            <br />
            Powered by Sequoia Quality Solutions.
          </p>

          {/* Action buttons */}
          <div className="flex gap-3 justify-center mb-5">
            <button
              className="btn btn-primary px-5 gap-1"
              onClick={() => (window.location.href = '/login')}
            >
              → Client Login ›
            </button>
            <button
              className="btn btn-outline border-primary text-primary hover:bg-primary hover:text-primary-content px-5 gap-1"
              onClick={() => (window.location.href = '/sqs-admin')}
            >
              ◇ Admin Login ›
            </button>
          </div>

          {/* Separator */}
          <div className="mx-auto max-w-[200px] h-px bg-base-content/10 mb-5" />

          {/* Demo CTA */}
          <p className="text-sm text-base-content/60 mb-3">
            Interested in Field Service Time Tracker for your team?
          </p>
          <a
            href="mailto:sequoiaqualitysolutions@gmail.com?subject=Field Service Time Tracker Demo Request"
            className="btn btn-neutral btn-sm gap-1 mb-3"
          >
            ✉ Book a Demo ›
          </a>
          <br />
          <a
            href="mailto:sequoiaqualitysolutions@gmail.com?subject=Field Service Time Tracker Info"
            className="text-xs text-primary hover:underline"
          >
            Learn more about Field Service Time Tracker →
          </a>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 text-center py-6 px-4 border-t border-base-content/10 bg-base-200/50">
        <div className="flex justify-center gap-4 text-xs text-base-content/40 mb-2">
          <span className="hover:text-primary cursor-pointer">About</span>
          <span>|</span>
          <span className="hover:text-primary cursor-pointer">Privacy</span>
          <span>|</span>
          <span className="hover:text-primary cursor-pointer">Terms</span>
        </div>
        <p className="text-xs text-base-content/40 mb-1">
          © {new Date().getFullYear()} Sequoia Quality Solutions. All rights reserved.
        </p>
        <p className="text-[11px] text-base-content/30 mb-1">
          Field Service Time Tracker™ is a trademark of Sequoia Quality Solutions.
        </p>
        <p className="text-[10px] text-base-content/25">
          This application is confidential and intended for authorized recipients only.
        </p>
      </footer>
    </div>
  );
};
