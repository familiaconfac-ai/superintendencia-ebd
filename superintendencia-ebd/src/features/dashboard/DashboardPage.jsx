import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Card, { CardHeader, SummaryCard } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { listPeople } from '../../services/peopleService'
import { listTeachers } from '../../services/teacherService'
import { listClasses } from '../../services/classService'
import { listEnrollments } from '../../services/enrollmentService'
import { calculateMemberEnrollmentMetrics, isEnrollmentCurrentlyActive } from '../../utils/enrollmentMetrics'

export default function DashboardPage() {
  const { user, canManageStructure, role } = useAuth()
  const navigate = useNavigate()

  const [people, setPeople] = useState([])
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [enrollments, setEnrollments] = useState([])

  useEffect(() => {
    if (!user?.uid) return

    async function load() {
      const [peopleList, teacherList, classList, enrollmentList] = await Promise.all([
        listPeople(user.uid),
        listTeachers(user.uid),
        listClasses(user.uid),
        listEnrollments(user.uid),
      ])
      setPeople(peopleList)
      setTeachers(teacherList)
      setClasses(classList)
      setEnrollments(enrollmentList)
    }

    load()
  }, [user?.uid])

  // Fonte oficial do dashboard:
  // pessoas cadastradas e matriculas ativas seguem a mesma regra da tela Matriculas EBD.
  const memberMetrics = useMemo(
    () => calculateMemberEnrollmentMetrics(people, enrollments),
    [people, enrollments],
  )

  const totalPeople = useMemo(() => memberMetrics.totalMembers, [memberMetrics.totalMembers])
  const totalTeachers = useMemo(
    () => teachers.filter((item) => item.active !== false).length,
    [teachers],
  )
  const totalClasses = useMemo(() => classes.filter((item) => item.active !== false).length, [classes])
  const totalActiveEnrollments = useMemo(
    () => memberMetrics.currentEnrolledMembers,
    [memberMetrics.currentEnrolledMembers],
  )

  useEffect(() => {
    console.log('[DASHBOARD_DEBUG] pessoas', {
      collection: 'people',
      filtros: {
        active: 'active !== false',
        churchStatus: "churchStatus === 'member'",
      },
      quantidadeFinal: totalPeople,
      amostra: people
        .filter((item) => item?.active !== false && item?.churchStatus === 'member')
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          fullName: item.fullName,
          churchStatus: item.churchStatus,
          active: item.active,
        })),
    })

    console.log('[DASHBOARD_DEBUG] professores', {
      collection: 'teachers',
      filtros: {
        active: 'active !== false',
      },
      quantidadeFinal: totalTeachers,
      amostra: teachers
        .filter((item) => item?.active !== false)
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          fullName: item.fullName,
          email: item.email,
          active: item.active,
        })),
    })

    console.log('[DASHBOARD_DEBUG] classesAtivas', {
      collection: 'classes',
      filtros: {
        active: 'active !== false',
      },
      quantidadeFinal: totalClasses,
      amostra: classes
        .filter((item) => item?.active !== false)
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          name: item.name,
          active: item.active,
          defaultTeacherId: item.defaultTeacherId,
        })),
    })

    console.log('[DASHBOARD_DEBUG] matriculasAtivas', {
      collection: 'enrollments',
      filtros: {
        pessoaBaseOficial: "people.active !== false && people.churchStatus === 'member'",
        matriculaAtiva: "status === 'active' && enrolledInEBD !== false",
        regraContagem: 'conta membros unicos matriculados, igual a tela Matriculas EBD',
      },
      quantidadeFinal: totalActiveEnrollments,
      amostra: enrollments
        .filter((item) => isEnrollmentCurrentlyActive(item))
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          personId: item.personId,
          classId: item.classId,
          status: item.status,
          enrolledInEBD: item.enrolledInEBD,
        })),
    })
  }, [classes, enrollments, people, teachers, totalActiveEnrollments, totalClasses, totalPeople, totalTeachers])

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
