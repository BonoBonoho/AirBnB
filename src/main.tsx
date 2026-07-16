import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import { StoreProvider } from './lib/store'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Calendar from './pages/Calendar'
import Listings from './pages/Listings'
import Rules from './pages/Rules'
import Market from './pages/Market'
import Channels from './pages/Channels'

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/calendar', element: <Calendar /> },
      { path: '/listings', element: <Listings /> },
      { path: '/rules', element: <Rules /> },
      { path: '/market', element: <Market /> },
      { path: '/channels', element: <Channels /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  </StrictMode>,
)
