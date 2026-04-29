import { useVscodeStore } from 'attach-ui-lib';
import './App.css'
import DeviceTree from './device-tree/DeviceTree'
import { useEffect } from 'react';

function App() {
  const { initialize, cleanup } = useVscodeStore();

  // Initialize VS Code API on mount
  useEffect(() => {
    initialize();
    return () => {
      cleanup();
    };
  }, [initialize, cleanup]);

  return (
    <DeviceTree />
  )
}

export default App
