import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { LessonControlProvider } from './context/LessonControlContext'
import AppRoutes from './routes/AppRoutes'
import './styles/global.css'
import './features/features.css'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LessonControlProvider>
          <AppRoutes />
        </LessonControlProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
