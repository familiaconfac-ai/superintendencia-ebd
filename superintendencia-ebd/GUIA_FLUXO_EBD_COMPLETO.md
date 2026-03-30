# 📚 FLUXO COMPLETO - APP EBD ESTRUTURADO

## ✅ O QUE JÁ EXISTE NO APP

O app EBD **já possui** toda a estrutura necessária!

```
┌─────────────┐
│ 1. ALUNOS   │ ← PeoplePage.jsx
│ Cadastrar   │   Criar, editar, listar alunos
│ Editar      │   Collection: users/{uid}/ebd_people
│ Deletar     │
└─────────────┘
       ↓
┌─────────────┐
│ 2. PROFESSOR│ ← TeachersPage.jsx
│ Cadastrar   │   Criar, editar, listar professores
│ Editar      │   Collection: users/{uid}/ebd_teachers
│ Deletar     │
└─────────────┘
       ↓
┌─────────────┐
│ 3. CLASSES  │ ← ClassesPage.jsx
│ Criar       │   Criar, editar, listar classes
│ Editar      │   Vincula professor à classe
│ Deletar     │   Collection: users/{uid}/ebd_classes
└─────────────┘
       ↓
┌─────────────┐
│ 4. MATRÍCULAS│ ← EnrollmentsPage.jsx
│ Vincular    │   Conecta alunos a classes
│ Ativar      │   Collection: users/{uid}/ebd_enrollments
│ Desativar   │   Precisa: personId + classId
└─────────────┘
       ↓
┌─────────────────┐
│ 5. CADERNETA    │ ← AttendancePage.jsx
│ Criar registro  │   Cria registro mensal por classe
│ Lançar presença │   Carrega alunos automaticamente
│ Exportar PDF    │   Collection: users/{uid}/ebd_attendance
└─────────────────┘
```

---

## 🔄 FLUXO OPERACIONAL RECOMENDADO

### **Semana 1: Preparação**

#### **Passo 1: Cadastrar Professor**
```
Menu → Professores
Clique "Novo Professor"
Preencha: Nome, Telefone, Observações
Salve
```

✅ Professor registrado: `users/{uid}/ebd_teachers/{id}`

---

#### **Passo 2: Cadastrar Alunos**
```
Menu → Alunos
Clique "Novo Aluno"
Preencha: Nome, Telefone, Status (Membro, Visitante, etc)
Salve
Repita para cada aluno
```

✅ Alunos registrados: `users/{uid}/ebd_people/{id}` (múltiplos)

---

#### **Passo 3: Criar Classe**
```
Menu → Classes
Clique "Nova Classe"
Preencha: 
  - Nome: "Adultos", "Jovens", etc
  - Departamento: opcional
  - Professor: selecione professor criado
Salve
```

✅ Classe criada: `users/{uid}/ebd_classes/{id}`

---

### **Semana 2: Vinculação**

#### **Passo 4: Vincular Alunos à Classe**
```
Menu → Matrículas
Clique "Nova Matrícula"
Selecione: 
  - Aluno
  - Classe (criada no passo 3)
  - Data de matrícula
Salve
Repita para cada aluno da classe
```

✅ Matrículas criadas: `users/{uid}/ebd_enrollments/{id}` (múltiplas)

**Estrutura de 1 matrícula:**
```json
{
  "personId": "aluno id",
  "classId": "classe id",
  "className": "Adultos",
  "enrolledInEBD": true,
  "enrollmentDate": "2026-03-30",
  "status": "active",
  "notes": ""
}
```

---

### **Semana 3: Presença**

#### **Passo 5: Criar Caderneta e Lançar Presença**
```
Menu → Caderneta Mensal
Seção "Nova caderneta":
  - Professor: selecione professor
  - Classe: selecione classe
  - Mês/Ano: automático
  - Disciplina: ex "Estudo Bíblico"
Clique botão "Criar Caderneta"

AUTOMÁTICAMENTE:
  ↓ Carrega alunos vinculados à classe
  ↓ Cria matriz presença/ausência
  ↓ Salva registro

Agora marque presença:
  - Clique na célula aluno/data
  - Cicla entre: Sem marcar → Presente → Falta → Sem marcar
  - Salva automaticamente
  
Ao final:
  - Exporte PDF com relatório
```

✅ Caderneta criada: `users/{uid}/ebd_attendance/{id}`

---

## 📊 ESTRUTURA DE DADOS NO FIRESTORE

```
Firestore
├── users/{uid}/
│   ├── ebd_people/          ← Alunos
│   │   ├── student001
│   │   │   ├── fullName: "João"
│   │   │   ├── phone: "11999999"
│   │   │   ├── churchStatus: "member"
│   │   │   ├── active: true
│   │   │   └── createdAt: timestamp
│   │   └── student002
│   │
│   ├── ebd_teachers/        ← Professores
│   │   ├── prof001
│   │   │   ├── fullName: "Maria"
│   │   │   ├── phone: "11988888"
│   │   │   ├── active: true
│   │   │   └── createdAt: timestamp
│   │   └── prof002
│   │
│   ├── ebd_classes/         ← Classes
│   │   ├── class001
│   │   │   ├── name: "Adultos"
│   │   │   ├── department: "EBD"
│   │   │   ├── defaultTeacherId: "prof001"
│   │   │   ├── defaultTeacherName: "Maria"
│   │   │   ├── active: true
│   │   │   └── createdAt: timestamp
│   │   └── class002
│   │
│   ├── ebd_enrollments/     ← Matrículas (Aluno → Classe)
│   │   ├── enroll001
│   │   │   ├── personId: "student001"
│   │   │   ├── classId: "class001"
│   │   │   ├── className: "Adultos"
│   │   │   ├── status: "active"
│   │   │   ├── enrollmentDate: "2026-01-05"
│   │   │   └── createdAt: timestamp
│   │   └── enroll002
│   │
│   └── ebd_attendance/      ← Cadernetas (Presença)
│       ├── register001
│       │   ├── classId: "class001"
│       │   ├── className: "Adultos"
│       │   ├── teacherId: "prof001"
│       │   ├── teacherName: "Maria"
│       │   ├── discipline: "Estudo Bíblico"
│       │   ├── month: 3
│       │   ├── year: 2026
│       │   ├── enrolledStudentIds: ["student001", "student002"]
│       │   ├── attendanceByStudent: {
│       │   │   "student001": {
│       │   │     "2026-03-02": "P",  // Presente
│       │   │     "2026-03-09": "F",  // Falta
│       │   │     "2026-03-16": ""    // Não marcado
│       │   │   }
│       │   └── }
│       └── register002
```

---

## 🔐 PERMISSÕES

| Ação | Admin | Professor |
|------|-------|-----------|
| Criar/Editar/Deletar Aluno | ✅ | ❌ |
| Criar/Editar/Deletar Professor | ✅ | ❌ |
| Criar/Editar/Deletar Classe | ✅ | ❌ |
| Criar Matrícula | ✅ | ❌ |
| Criar Caderneta | ✅ | ❌ (só professor autorizado) |
| Lançar Presença | ✅ | ✅ (apenas suas classes) |
| Exportar PDF | ✅ | ✅ |

---

## 🎯 CHECKLIST COMPLETO

- [ ] **1. Ir para Professores**
  - Clicar "Novo Professor"
  - Preencher nome, telefone
  - Salvar

- [ ] **2. Ir para Alunos**
  - Clicar "Novo Aluno"
  - Preencher nome, telefone
  - Salvar (repetir para 3-5 alunos)

- [ ] **3. Ir para Classes**
  - Clicar "Nova Classe"
  - Preencher nome, departamento
  - Selecionar professor criado
  - Salvar

- [ ] **4. Ir para Matrículas**
  - Clicar "Nova Matrícula"
  - Selecionar aluno
  - Selecionar classe
  - Salvar (repetir para cada aluno)

- [ ] **5. Ir para Caderneta Mensal**
  - Na seção "Nova caderneta":
    - Selecionar professor
    - Selecionar classe
    - Preencher disciplina
    - Clicar "Criar Caderneta"
  - Marcar presença dos alunos
  - Exportar PDF

---

## 📁 ARQUIVOS UTILIZADOS

| Arquivo | Função |
|---------|--------|
| `src/features/people/PeoplePage.jsx` | Interface de alunos |
| `src/features/teachers/TeachersPage.jsx` | Interface de professores |
| `src/features/classes/ClassesPage.jsx` | Interface de classes |
| `src/features/enrollments/EnrollmentsPage.jsx` | Interface de matrículas |
| `src/features/attendance/AttendancePage.jsx` | Interface de caderneta |
| `src/services/peopleService.js` | CRUD de alunos |
| `src/services/teacherService.js` | CRUD de professores |
| `src/services/classService.js` | CRUD de classes |
| `src/services/enrollmentService.js` | CRUD de matrículas |
| `src/services/attendanceService.js` | CRUD de cadernetas |

---

## 🚀 APLICAÇÃO PRONTA PARA USO!

Todo o sistema já está implementado. Basta seguir o fluxo operacional acima e o app funcionará perfeitamente.

---

## 📌 NOTAS FINAIS

1. **Alunos da mesma classe devem estar vinculados via Matrículas**
2. **Caderneta carrega automaticamente os alunos da classe selecionada**
3. **Presença é por aluno × domingo × mês**
4. **Admin pode criar/editar tudo**
5. **Professor só pode lançar presença em suas classes**

---

## 🔗 INTEGRAÇÃO COM FIREBASE RULES

As regras de segurança devem permitir:
```firestore
match /users/{uid}/ebd_{bucket}/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
```

Isso garante que cada usuário acessa apenas seus dados (Alunos, Classes, Matrículas, Cadernetas).

---

**Status:** ✅ App EBD está **PRONTO** com estrutura completa e funcional!
