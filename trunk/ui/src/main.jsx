import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { applyCachedTheme } from './theme'

// apply the cached theme before first paint so a reload doesn't flash Classic
// before /auth/me loads the user's real choice (which then reconciles it)
applyCachedTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)