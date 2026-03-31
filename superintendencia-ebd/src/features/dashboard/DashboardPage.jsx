import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Card, { CardHeader, SummaryCard } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { listPeople } from '../../services/peopleService'
import { listTeachers } from '../../services/teacherService'
import { listClasses } from '../../services/classService'
import { listEnrollments } from '../../services/enrollmentService'
import { listAttendanceRegisters } from '../../services/attendanceService'
import { formatMonthYear } from '../../utils/attendanceUtils'

export default function DashboardPage() {
  const { user, canManageStructure, role } = useAuth()
  const navigate = useNavigate()

  const [people, setPeople] = useState([])
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [registers, setRegisters] = useState([])

  useEffect(() => {
    if (!user?.uid) return

    async function load() {
      const [peopleList, teacherList, classList, enrollmentList, registerList] = await Promise.all([
        listPeople(user.uid),
        listTeachers(user.uid),
        listClasses(user.uid),
        listEnrollments(user.uid),
        listAttendanceRegisters(user.uid),
      ])
      setPeople(peopleList)
      setTeachers(teacherList)
      setClasses(classList)
      setEnrollments(enrollmentList)
      setRegisters(registerList)
    }

    load()
  }, [user?.uid])

  const totalPeople = useMemo(() => people.length, [people])
  const totalTeachers = useMemo(() => people.filter((item) => Array.isArray(item.roles) && item.roles.includes('teacher')).length, [people])
  const totalClasses = useMemo(() => classes.filter((item) => item.active !== false).length, [classes])
  const totalActiveEnrollments = useMemo(
    () => enrollments.filter((item) => item.status === 'active').length,
    [enrollments],
  )

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Painel da Superintendência</h2>
          <p className="feature-subtitle">
            {canManageStructure ? 'Gestão administrativa da Escola Bíblica Dominical' : 'Área do professor para acompanhamento da EBD'}
          </p>
        </div>
        <Button onClick={() => navigate('/caderneta')}>
          {canManageStructure ? 'Nova Caderneta' : 'Abrir Caderneta'}
        </Button>
      </div>

      <div className="grid-cards">
        <SummaryCard label="Pessoas cadastradas" value={String(totalPeople)} color="primary" icon="👥" onClick={() => navigate('/alunos')} clickable />
        <SummaryCard label="Professores" value={String(totalTeachers)} color="secondary" icon="🧑‍🏫" onClick={() => navigate('/professores')} clickable />
        <SummaryCard label="Classes ativas" value={String(totalClasses)} color="success" icon="🏫" onClick={() => navigate('/classes')} clickable />
        <SummaryCard label="Matrículas ativas" value={String(totalActiveEnrollments)} color="warning" icon="🧾" onClick={() => navigate('/matriculas')} clickable />
      </div>

      <Card>
        <CardHeader title="Atalhos" subtitle={`Perfil atual: ${role === 'admin' ? 'Administrador' : 'Professor'}`} />
        <div className="feature-actions">
          {canManageStructure && <Button variant="secondary" onClick={() => navigate('/alunos')}>Alunos</Button>}
          {canManageStructure && <Button variant="secondary" onClick={() => navigate('/professores')}>Professores</Button>}
          <Button variant="secondary" onClick={() => navigate('/classes')}>Classes</Button>
          {canManageStructure && <Button variant="secondary" onClick={() => navigate('/matriculas')}>Matrículas</Button>}
          <Button variant="secondary" onClick={() => navigate('/caderneta')}>Caderneta</Button>
          <Button variant="secondary" onClick={() => navigate('/comunicacao')}>Comunicação</Button>
        </div>
      </Card>

    </div>
  )
}
