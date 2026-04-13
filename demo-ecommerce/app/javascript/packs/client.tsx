import React, { useEffect, useState } from 'react';
import ReactOnRails from 'react-on-rails';
import App from '../components/App';

// Import stylesheets
import '../stylesheets/application.css';

const hydrationDelay = Number(new URLSearchParams(window.location.search).get('hydration_delay')) || 0;

function DelayedApp(props: React.ComponentProps<typeof App>) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      performance.mark('hydration-start');
      setReady(true);
    }, hydrationDelay);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) return null;
  return <App {...props} />;
}

if (hydrationDelay > 0) {
  ReactOnRails.register({ App: DelayedApp });
} else {
  performance.mark('hydration-start');
  ReactOnRails.register({ App });
}
