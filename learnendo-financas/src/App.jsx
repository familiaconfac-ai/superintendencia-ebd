import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { FinanceProvider } from './context/FinanceContext'
import AppRoutes from './routes/AppRoutes'
import './styles/global.css'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <FinanceProvider>
          <AppRoutes />
        </FinanceProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
