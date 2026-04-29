import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'hds-react/dist/styles/index.css';
import "hds-components/dist/tokens.css";
import 'attach-ui-lib/dist/styles/index.css';
import 'allotment/dist/style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

