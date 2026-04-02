import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { listAttendanceRegisters, removeAttendanceRegister } from '../../services/attendanceService'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { canAccessAttendanceRegister, isAdmin } from '../../utils/accessControl'
import { formatRegisterPeriod } from '../../utils/attendanceUtils'

export default function AttendanceListPage() {
  const { user, profile, canManageStructure } = useAuth()
  const navigate = useNavigate()
  const [registers, setRegisters] = useState([])
  const [loading, setLoading] = useState(true)

  async function loadData() {
    setLoading(true)
    try {
      const userIsAdmin = isAdmin(user)
      const allRegisters = await listAttendanceRegisters(user.uid)

      console.log('[ADMIN_CHECK]', {
        email: user?.email,
        isAdmin: userIsAdmin,
      })
      console.log('[ATTENDANCE_DEBUG] Usuario logado:', {
        userUid: user?.uid,
        userEmail: user?.email,
        profileId: profile?.uid || profile?.id,
        profileEmail: profile?.email,
        profileRole: profile?.role,
        totalRegisters: allRegisters.length,
        registerIds: allRegisters.map((register) => register.id),
      })

      const filtered = userIsAdmin
        ? allRegisters
        : allRegisters.filter((item) => {
          const hasAccess = canAccessAttendanceRegister(item, user, profile)
          console.log('[ATTENDANCE_DEBUG] Caderneta:', {
            userUid: user?.uid,
            userEmail: user?.email,
            profileId: profile?.uid || profile?.id,
            registerId: item.id,
            teacherAuthUid: item.teacherAuthUid,
            teacherUid: item.teacherUid,
            teacherId: item.teacherId,
            teacherEmail: item.teacherEmail,
            ownerUid: item.ownerUid,
            createdByUid: item.createdByUid,
            teacherName: item.teacherName,
            hasAccess,
          })
          return hasAccess
        })

      console.log('[ATTENDANCE_DEBUG] Cadernetas filtradas:', {
        filteredCount: filtered.length,
        filteredIds: filtered.map((register) => register.id),
      })

      setRegisters(filtered)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user?.uid) loadData()
    // eslint-disable-next-line
  }, [user?.uid])

  async function handleDelete(item) {
    if (!canManageStructure) return
    if (!window.confirm('Excluir esta caderneta?')) return

    await removeAttendanceRegister(item.storageOwnerUid || item.ownerUid || item.createdByUid || user.uid, item.id)
    await loadData()
  }

  function handleDuplicate(item) {
    if (!canManageStructure) return
    navigate('/caderneta/criar', {
      state: {
        duplicateRegister: item,
      },
    })
  }

  function handleOpen(item) {
    navigate(`/caderneta/${item.id}`, {
      state: {
        registerOwnerUid: item.storageOwnerUid || item.ownerUid || item.createdByUid || '',
      },
    })
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h2 className="feature-title">Cadernetas</h2>
        <p className="feature-subtitle">Visualize e abra cadernetas existentes</p>
      </div>
      <Card>
        <CardHeader title="Cadernetas cadastradas" />
        <div className="entity-list">
          {loading && <p>Carregando...</p>}
          {!loading && registers.length === 0 && <p className="feature-subtitle">Nenhuma caderneta encontrada.</p>}
          {registers.map((item) => (
            <div className="entity-row" key={item.id}>
              <div>
                <div className="entity-title">{item.className}</div>
                <div className="entity-meta">{formatRegisterPeriod(item)} • {item.teacherName}</div>
              </div>
              <div className="row-actions">
                <Button size="sm" onClick={() => handleOpen(item)}>Abrir</Button>
                {canManageStructure && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => handleDuplicate(item)}>Duplicar</Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(item)}>Excluir</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
