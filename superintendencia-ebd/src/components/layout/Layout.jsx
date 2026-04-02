import { Outlet } from 'react-router-dom'
import Header from './Header'
import BottomNav from './BottomNav'
import LessonControlOverlay from './LessonControlOverlay'
import './Layout.css'

export default function Layout() {
  return (
    <div className="app-layout">
      <Header />
      <main className="app-main">
        <Outlet />
      </main>
      <LessonControlOverlay />
      <BottomNav />
    </div>
  )
}
