/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Download, Share } from 'lucide-react';
import { Downloader } from './components/Downloader';

export default function App() {
  // Custom PWA install button (Chrome/Android/desktop fire beforeinstallprompt).
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e: any) => { e.preventDefault(); setInstallPrompt(e); };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    if (standalone) setInstalled(true);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } else {
      // iOS Safari has no prompt API — guide the user.
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isIos) setIosHint(true);
    }
  };

  const showInstall = !installed && (installPrompt || /iphone|ipad|ipod/i.test(navigator.userAgent));

  return (
    <div className="min-h-[100dvh] bg-[#F9F8F4] flex flex-col text-[#333333] font-sans">
      <nav className="px-5 md:px-12 py-5 md:py-6 flex justify-between items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 md:w-10 md:h-10 bg-[#5A5A40] rounded-full flex items-center justify-center flex-shrink-0">
            <div className="w-3.5 h-3.5 bg-white rounded-sm"></div>
          </div>
          <span className="text-lg md:text-xl font-bold tracking-tight text-[#5A5A40] truncate">STREAMGARDEN</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden lg:flex gap-8 text-sm font-medium text-[#5A5A40]/70 uppercase tracking-widest">
            <span>About</span>
            <span>Supported Platforms</span>
            <span>Terms</span>
          </div>
          {showInstall && (
            <button
              onClick={install}
              className="flex items-center gap-1.5 bg-[#5A5A40] text-white text-xs font-bold px-4 py-2 rounded-full hover:bg-[#4A4A35] active:scale-95 transition-all whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" /> Install App
            </button>
          )}
        </div>
      </nav>

      <main className="flex-1 flex flex-col items-center justify-center px-4 md:px-12 py-8 md:py-12">
        <Downloader />
      </main>

      {iosHint && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={() => setIosHint(false)}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-xl text-[#414132] mb-2">Install on iPhone</h3>
            <p className="text-sm text-[#5A5A40]/70 leading-relaxed">
              Tap the <Share className="inline w-4 h-4 -mt-0.5" /> <b>Share</b> button in Safari, then choose
              <b> “Add to Home Screen”</b>.
            </p>
            <button onClick={() => setIosHint(false)} className="mt-4 w-full bg-[#5A5A40] text-white py-2.5 rounded-full text-sm font-bold active:scale-95 transition-transform">Got it</button>
          </div>
        </div>
      )}

      <footer className="px-5 md:px-12 py-8 flex flex-col md:flex-row justify-between items-center border-t border-[#5A5A40]/10 gap-4 text-center md:text-left"
        style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-600"></div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-[#5A5A40]/40">System Status: Operational</span>
        </div>
        <div className="max-w-xs">
          <p className="text-[10px] leading-relaxed text-[#5A5A40]/50">StreamGarden only supports downloads from public accounts. We do not host any content. Please respect creators' copyrights.</p>
        </div>
      </footer>
    </div>
  );
}
