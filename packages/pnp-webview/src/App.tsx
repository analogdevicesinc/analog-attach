import { useEffect } from 'react';
import PnpConfig from './pnp/PnpConfig';
import { useVscodeStore } from './store';
import './App.css';

function App() {
  const { initialize, cleanup, isConnected } = useVscodeStore();

  // Initialize VS Code API on mount
  useEffect(() => {
    initialize();
    return () => {
      cleanup();
    };
  }, [initialize, cleanup]);

  // Wait for initialization to complete before rendering the app
  // This prevents stores from loading data before vscodeService is ready
  if (!isConnected) {
    return <div>Initializing...</div>;
  }

  return (
    <PnpConfig />
  );
}

export default App;
