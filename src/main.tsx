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
import DoorAdmin from './pages/DoorAdmin'
import DoorGuest from './pages/DoorGuest'
import FormAdmin from './pages/FormAdmin'
import GuestFormPage from './pages/GuestFormPage'

const router = createHashRouter([
  // 게스트용 독립 화면 (사이드바 없음)
  { path: '/door/:bookingId', element: <DoorGuest /> },
  { path: '/guestform/:token', element: <GuestFormPage /> },
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/calendar', element: <Calendar /> },
      { path: '/listings', element: <Listings /> },
      { path: '/rules', element: <Rules /> },
      { path: '/market', element: <Market /> },
      { path: '/channels', element: <Channels /> },
      { path: '/door', element: <DoorAdmin /> },
      { path: '/guestform', element: <FormAdmin /> },
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
