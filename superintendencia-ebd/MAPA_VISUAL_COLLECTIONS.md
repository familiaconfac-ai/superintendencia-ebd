# 🗂️ MAPA VISUAL DE COLLECTIONS - EBD FIRESTORE

```
Firestore Database (EBD Project)
│
├── 📁 users/
│   │
│   ├── 📄 {uid1} (Documento: Perfil do Usuário)
│   │   ├── uid: "abc123xyz..."
│   │   ├── email: "admin@ebd.com"
│   │   ├── displayName: "Admin"
│   │   ├── role: "admin"
│   │   ├── active: true
│   │   ├── createdAt: timestamp
│   │   │
│   │   └── 📚 Subcollections:
│   │       │
│   │       ├── 📂 accounts/
│   │       │   ├── 📄 acc001 (Conta Corrente)
│   │       │   ├── 📄 acc002 (Conta Poupança)
│   │       │   └── ...
│   │       │
│   │       ├── 📂 ebd_teachers/  ⭐ PROFESSORES
│   │       │   ├── 📄 prof001 → {fullName, phone, notes, active}
│   │       │   ├── 📄 prof002
│   │       │   └── ...
│   │       │
│   │       ├── 📂 ebd_people/  👥 ALUNOS
│   │       │   ├── 📄 student001 → {fullName, phone, churchStatus}
│   │       │   ├── 📄 student002
│   │       │   └── ...
│   │       │
│   │       ├── 📂 ebd_classes/  🏫 CLASSES
│   │       │   ├── 📄 class001 → {name, department, defaultTeacher}
│   │       │   └── ...
│   │       │
│   │       ├── 📂 ebd_enrollments/  🧾 MATRÍCULAS
│   │       │   ├── 📄 enroll001 → {personId, classId, status}
│   │       │   └── ...
│   │       │
│   │       ├── 📂 ebd_attendance/  📒 CADERNETAS
│   │       │   ├── 📄 register001 → {classId, month, year, presences}
│   │       │   └── ...
│   │       │
│   │       ├── 📂 workspaceMemberships/
│   │       │   ├── 📄 ws001 → {role: "gestor", status: "active"}
│   │       │   └── ...
│   │       │
│   │       └── 📂 settings/
│   │           └── 📄 workspace → {preferences}
│   │
│   ├── 📄 {uid2}
│   ├── 📄 {uid3}
│   └── ...
│
└── 📁 workspaces/ ⚠️ DESABILITADO
    │
    ├── 📄 ws001 (Finanças Família)
    │   ├── name: "Finanças EBD"
    │   ├── type: "family"
    │   ├── active: true
    │   │
    │   └── 📚 Subcollections:
    │       │
    │       ├── 📂 members/
    │       │   ├── 📄 abc123xyz/ → {role: "gestor", status: "active"}
    │       │   ├── 📄 def456uvw/ → {role: "membro", status: "active"}
    │       │   └── ...
    │       │
    │       ├── 📂 accounts/
    │       │   ├── 📄 bank001 → {name, balance}
    │       │   └── ...
    │       │
    │       ├── 📂 transactions/
    │       │   ├── 📄 tx001 → {amount, date, category}
    │       │   └── ...
    │       │
    │       ├── 📂 categories/
    │       │   ├── 📄 cat001 → {name, icon}
    │       │   └── ...
    │       │
    │       ├── 📂 debts/
    │       │   ├── 📄 debt001 → {name, amount, status}
    │       │   └── ...
    │       │
    │       ├── 📂 contacts/
    │       │   ├── 📄 contact001 → {name, type}
    │       │   └── ...
    │       │
    │       └── 📂 transactionNatures/
    │           ├── 📄 nature_salary
    │           ├── 📄 nature_expense_food
    │           └── ...
    │
    ├── 📄 ws002
    └── ...
```

---

## 📊 TABELA RÁPIDA DE PATHS

| Feature | Arquivo | Função | Firebase Path | Status |
|---------|---------|--------|---------------|--------|
| **👤 Perfil Admin** | `src/firebase/auth.js` | `registerUser()` | `users/{uid}` | ✅ OK |
| **👤 Atualizar Perfil** | `src/firebase/auth.js` | `updateUserProfileData()` | `users/{uid}` | ✅ OK |
| **🏦 Contas Bancárias** | `src/services/accountService.js` | `addAccount()` | `users/{uid}/accounts/{id}` | ✅ OK |
| **🏦 Atualizar Conta** | `src/services/accountService.js` | `updateAccount()` | `users/{uid}/accounts/{id}` | ✅ OK |
| **🏦 Deletar Conta** | `src/services/accountService.js` | `deleteAccount()` | `users/{uid}/accounts/{id}` | ✅ OK |
| **👨‍🏫 Criar Professor** | `src/services/ebdDataService.js` | `saveEbdDocument()` | `users/{uid}/ebd_teachers/{id}` | ⚠️ ERROR |
| **👨‍🏫 Editar Professor** | `src/services/ebdDataService.js` | `saveEbdDocument()` | `users/{uid}/ebd_teachers/{id}` | ⚠️ ERROR |
| **👨‍🏫 Deletar Professor** | `src/services/ebdDataService.js` | `removeEbdDocument()` | `users/{uid}/ebd_teachers/{id}` | ⚠️ ERROR |
| **👥 Criar Aluno** | `src/services/ebdDataService.js` | `saveEbdDocument()` | `users/{uid}/ebd_people/{id}` | ⚠️ ERROR |
| **🏫 Criar Classe** | `src/services/ebdDataService.js` | `saveEbdDocument()` | `users/{uid}/ebd_classes/{id}` | ⚠️ ERROR |
| **🧾 Criar Matrícula** | `src/services/ebdDataService.js` | `saveEbdDocument()` | `users/{uid}/ebd_enrollments/{id}` | ⚠️ ERROR |
| **📒 Criar Caderneta** | `src/services/ebdDataService.js` | `saveEbdDocument()` | `users/{uid}/ebd_attendance/{id}` | ⚠️ ERROR |
| **💰 Workspace** | `src/services/workspaceService.js` | `createWorkspace()` | `workspaces/{id}` | ❌ BLOQUEADO |
| **💰 Dívida** | `src/services/debtService.js` | `createDebt()` | `workspaces/{id}/debts/{id}` | ❌ BLOQUEADO |

---

## 🔐 FIRESTORE SECURITY RULES

### ATUAL (Conforme subido)

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    match /{document=**} {
      allow read, write: if false;
    }

    match /users/{uid}/{document=**} {
      allow read, write: if request.auth.uid == uid;
    }

    match /workspaces/{document=**} {
      allow read, write: if false;
    }
  }
}
```

### NECESSÁRIO (Para EBD funcionar completamente)

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 🔒 NEGAR TUDO POR PADRÃO
    match /{document=**} {
      allow read, write: if false;
    }

    // 👤 USUÁRIOS
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
    
    // 📚 SUBCOLEÇÕES DE USUÁRIO
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth.uid == uid;
    }

    // 💰 WORKSPACES (Multi-user)
    // ⚠️ TO DO: Implementar verificação de membros
    match /workspaces/{workspaceId} {
      allow read, write: if false;  // Desabilitado até implementar members check
    }
    
    match /workspaces/{workspaceId}/{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## 📌 PONTOS CRÍTICOS

### ✅ FUNCIONANDO
- ✅ `users/{uid}` - Perfil do usuário
- ✅ `users/{uid}/accounts/*` - Contas bancárias
- ✅ Qualquer subcollection dentro de `users/{uid}/*` com a regra wildcard

### ⚠️ COM ERRO "permission-denied"
- ⚠️ `users/{uid}/ebd_teachers/*` - Professores
- ⚠️ `users/{uid}/ebd_people/*` - Alunos
- ⚠️ `users/{uid}/ebd_classes/*` - Classes
- ⚠️ `users/{uid}/ebd_enrollments/*` - Matrículas  
- ⚠️ `users/{uid}/ebd_attendance/*` - Cadernetas

**Por quê?** Provável: Rules não foi publicada OU UID incompatível

### ❌ BLOQUEADO INTENCIONALALMENTE
- ❌ `workspaces/*` - Workspaces financeiros
- ❌ `workspaces/{id}/members/*` - Membros
- ❌ `workspaces/{id}/debts/*` - Dívidas

---

## 🧪 TESTE DE CONNECTIVITY

Para verificar se a regra está funcionando, execute NO CONSOLE:

```javascript
// Teste 1: Ler dados do usuário (deve funcionar)
firebase.firestore()
  .collection('users')
  .doc(firebase.auth().currentUser.uid)
  .get()
  .then(doc => {
    if (doc.exists) console.log('✅ Leitura funcionou:', doc.data())
    else console.log('❌ Documento não existe')
  })
  .catch(err => console.log('❌ ERRO:', err.message))

// Teste 2: Escrever dados do usuário (deve funcionar)
firebase.firestore()
  .collection('users')
  .doc(firebase.auth().currentUser.uid)
  .set({test: true}, {merge: true})
  .then(() => console.log('✅ Escrita funcionou'))
  .catch(err => console.log('❌ ERRO:', err.message))

// Teste 3: Escrever em subcollection (deve funcionar se regra está correta)
const uid = firebase.auth().currentUser.uid
firebase.firestore()
  .collection('users').doc(uid)
  .collection('ebd_teachers')
  .doc('test123')
  .set({name: 'Test Teacher'})
  .then(() => console.log('✅ Subcollection escrita funcionou'))
  .catch(err => console.log('❌ ERRO na subcollection:', err.message))

// Teste 4: Tentar acessar workspace (deve falhar)
firebase.firestore()
  .collection('workspaces')
  .doc('ws001')
  .get()
  .then(doc => console.log('⚠️ Deveria ter falhado:', doc.data()))
  .catch(err => console.log('✅ Esperado ter falhado:', err.message))
```

---

## 💡 INSIGHTS DA AUDITORIA

1. **Padrão de organização:** Todos os dados EBD usam subcollections dentro de `users/{uid}`
2. **Vantagem:** Cada usuário vê apenas seus dados automaticamente
3. **Desvantagem:** Workspaces multi-user (finanças) não são suportados ainda
4. **Recomendação:** Se quiser compartilhar workspaces, implementar system de `members` com verificação nas rules

---

## 🎯 PRÓXIMO PASSO

Verifique o arquivo: **RESUMO_EXECUTIVO_AUDITORIA.md** para instruções passo a passo de como debugar e corrigir.
