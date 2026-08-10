import { useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';

/** Sidebar navigation + main content area, wrapping every authenticated page. */
export default function Layout({ children }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex">
      <Sidebar isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/*
        min-w-0 is load-bearing: a flex child defaults to min-width:auto, so a
        wide table or stepper inside would push this past the viewport and make
        the whole page scroll sideways instead of scrolling within its own
        container. Padding steps down on small screens — a fixed p-8 spends 64px
        of a 375px phone on empty margin.
      */}
      <main className="h-screen min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="mb-4 inline-flex items-center justify-center rounded-md border border-gray-200 p-2 text-gray-600 hover:bg-gray-100 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        {children}
      </main>
    </div>
  );
}
