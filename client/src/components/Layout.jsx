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

      <main className="h-screen flex-1 overflow-y-auto p-8">
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
