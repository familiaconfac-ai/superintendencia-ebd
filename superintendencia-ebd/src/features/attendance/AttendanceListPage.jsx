import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { listAttendanceRegisters, removeAttendanceRegister } from '../../services/attendanceService'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { belongsToTeacherRecord } from '../../utils/accessControl'
import { formatMonthYear } from '../../utils/attendanceUtils'

export default function AttendanceListPage() {
  const { user, profile, canManageStructure } = useAuth()
  const [registers, setRegisters] = useState([])
  const [loading, setLoading] = useState(true)

  async function loadData() {
    setLoading(true)
    try {
      const allRegisters = await listAttendanceRegisters(user.uid)
      let filtered = []
      if (canManageStructure) {
        filtered = allRegisters
      } else {
        const userEmail = (user?.email || '').toLowerCase()
        filtered = allRegisters.filter((item) => {
          if (item.teacherAuthUid && user?.uid) return item.teacherAuthUid === user.uid
          if (item.teacherEmail && userEmail) return (item.teacherEmail || '').toLowerCase() === userEmail
          return belongsToTeacherRecord(item, user, profile)
        })
      }
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
    await removeAttendanceRegister(user.uid, item.id)
    await loadData()
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
                <div className="entity-meta">{formatMonthYear(item.month, item.year)} • {item.teacherName}</div>
              </div>
              <div className="row-actions">
                <Button size="sm" onClick={() => window.location.href = `/caderneta/${item.id}`}>Abrir</Button>
                {canManageStructure && (
                  <Button size="sm" variant="danger" onClick={() => handleDelete(item)}>Excluir</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
