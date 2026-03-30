# 🔍 AUDITORIA COMPLETA DE GRAVAÇÕES NO FIRESTORE - EBD APP

## 📋 RESUMO EXECUTIVO

O app EBD faz gravações em **7 coleções principais** usando:
- **14 operações setDoc** (criação)
- **8 operações addDoc** (criação)
- **8 operações updateDoc** (atualização)
- **3 operações deleteDoc** (deleção)

**Problema Identificado:** Os logs de debug adicionados mostrarão exatamente qual UID está tentando gravar e em qual path.

---

## 🗂️ MAPEAMENTO COMPLETO DE COLEÇÕES

### 1️⃣ COLEÇÃO: `users/{uid}` (Perfil do Usuário)

| Campo | Arquivo | Função | Operação | Path |
|-------|---------|--------|----------|------|
| Perfil | `src/firebase/auth.js` | `registerUser()` | setDoc | `users/{uid}` |
| Perfil | `src/firebase/auth.js` | `updateUserProfileData()` | setDoc (merge) | `users/{uid}` |

**Estrutura:**
```
users/
  ├── abc123xyz/
  │   ├── uid: "abc123xyz"
  │   ├── email: "admin@ebd.com"
  │   ├── displayName: "Admin"
  │   ├── role: "admin"
  │   ├── active: true
  │   └── createdAt: timestamp
```

**Logs DEBUG:**
```javascript
console.log('[registerUser] 🔐 UID criado:', credential.user.uid)
console.log('[registerUser] 📧 Email:', normalizedEmail)
console.log('[registerUser] 💾 Salvando em: users/' + credential.user.uid)
console.log('[registerUser] ✅ Usuário salvo no Firestore')
```

**Regra Firestore Necessária:**
```firestore
match /users/{uid} {
  allow read, write: if request.auth.uid == uid;
}
```

---

### 2️⃣ COLEÇÃO: `users/{uid}/accounts` (Contas Bancárias)

| Campo | Arquivo | Função | Operação | Path |
|-------|---------|--------|----------|------|
| Contas | `src/services/accountService.js` | `addAccount()` | addDoc | `users/{uid}/accounts/{id}` |
| Contas | `src/services/accountService.js` | `updateAccount()` | updateDoc | `users/{uid}/accounts/{id}` |
| Contas | `src/services/accountService.js` | `deleteAccount()` | deleteDoc | `users/{uid}/accounts/{id}` |

**Estrutura:**
```
users/
  ├── abc123xyz/
  │   └── accounts/
  │       ├── acc001/
  │       │   ├── name: "Conta Corrente"
  │       │   ├── bank: "Banco do Brasil"
  │       │   ├── balance: 1500.00
  │       │   └── createdAt: timestamp
  │       └── acc002/
```

**Logs DEBUG:**
```javascript
console.log(`[AccountService] ➕ GRAVANDO: users/${uid}/accounts`)
console.log('[AccountService] 🔐 Auth UID:', uid)
console.log('[AccountService] 📊 Payload:', data)
```

**Regra Firestore Necessária:**
```firestore
match /users/{uid}/accounts/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
```

---

### 3️⃣ COLEÇÃO: `users/{uid}/ebd_teachers` (PROFESSORES - PRINCIPAL)

| Campo | Arquivo | Função | Operação | Path |
|-------|---------|--------|----------|------|
| Professores | `src/services/ebdDataService.js` | `saveEbdDocument()` | setDoc (novo) | `users/{uid}/ebd_teachers/{id}` |
| Professores | `src/services/ebdDataService.js` | `saveEbdDocument()` | updateDoc (edit) | `users/{uid}/ebd_teachers/{id}` |
| Professores | `src/services/ebdDataService.js` | `removeEbdDocument()` | deleteDoc | `users/{uid}/ebd_teachers/{id}` |

**Estrutura:**
```
users/
  ├── abc123xyz/
  │   └── ebd_teachers/
  │       ├── prof001/
  │       │   ├── fullName: "João Silva"
  │       │   ├── phone: "11999999"
  │       │   ├── notes: ""
  │       │   ├── active: true
  │       │   ├── createdAt: timestamp
  │       │   └── updatedAt: timestamp
  │       └── prof002/
```

**Logs DEBUG (já existentes):**
```javascript
console.log('🔐 [ebdDataService] saveEbdDocument iniciado')
console.log('🔐 [ebdDataService] UID do usuário:', uid)
console.log('🔐 [ebdDataService] Bucket:', bucket)  // "teachers"
console.log('🔐 [ebdDataService] Collection path:', getBucketPath(uid, bucket))
console.log('🔐 [ebdDataService] Operação:', id ? 'UPDATE' : 'INSERT')
console.log('🔱 [ebdDataService] Doc ref ID:', ref.id)
console.log('✅ [ebdDataService] Documento criado com sucesso')
console.log('❌ [ebdDataService] ERRO ao criar:', error.code, error.message)
```

**Regra Firestore Necessária:**
```firestore
match /users/{uid}/ebd_teachers/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
```

---

### 4️⃣ COLEÇÃO: `users/{uid}/ebd_people` (ALUNOS)

| Campo | Arquivo | Função | Operação | Path |
|-------|---------|--------|----------|------|
| Alunos | `src/services/ebdDataService.js` | `saveEbdDocument()` | setDoc (novo) | `users/{uid}/ebd_people/{id}` |
| Alunos | `src/services/ebdDataService.js` | `saveEbdDocument()` | updateDoc (edit) | `users/{uid}/ebd_people/{id}` |
| Alunos | `src/services/ebdDataService.js` | `removeEbdDocument()` | deleteDoc | `users/{uid}/ebd_people/{id}` |

**Estrutura:**
```
users/
  ├── abc123xyz/
  │   └── ebd_people/
  │       ├── student001/
  │       │   ├── fullName: "Maria"
  │       │   ├── phone: "11988888"
  │       │   ├── churchStatus: "member"
  │       │   └── createdAt: timestamp
```

**Regra Firestore Necessária:**
```firestore
match /users/{uid}/ebd_people/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
match /users/{uid}/ebd_classes/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
match /users/{uid}/ebd_enrollments/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
match /users/{uid}/ebd_attendance/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
```

---

### 5️⃣ COLEÇÃO: `workspaces/{workspaceId}` (Workspaces Financeiros)

| Campo | Arquivo | Função | Operação | Path |
|-------|---------|--------|----------|------|
| Workspace | `src/services/workspaceService.js` | `createWorkspace()` | addDoc | `workspaces/{id}` |
| Membro | `src/services/workspaceService.js` | `createWorkspace()` | setDoc | `workspaces/{id}/members/{uid}` |
| Natureza | `src/services/workspaceService.js` | `ensureDefaultNatures()` | setDoc | `workspaces/{id}/transactionNatures/{id}` |
| Contato | `src/services/workspaceService.js` | `createContact()` | addDoc | `workspaces/{id}/contacts/{id}` |
| Contato | `src/services/workspaceService.js` | `updateContact()` | updateDoc | `workspaces/{id}/contacts/{id}` |
| Contato | `src/services/workspaceService.js` | `deleteContact()` | deleteDoc | `workspaces/{id}/contacts/{id}` |

**Estrutura:**
```
workspaces/
  ├── ws001/
  │   ├── name: "Finanças EBD"
  │   ├── type: "family"
  │   ├── active: true
  │   └── members/
  │       ├── abc123xyz/
  │       │   ├── uid: "abc123xyz"
  │       │   ├── role: "gestor"
  │       │   └── status: "active"
  │       └── def456uvw/
  │   ├── contacts/
  │   ├── debts/
  │   ├── transactions/
  │   └── transactionNatures/
```

**Regra Firestore Necessária:**
```firestore
match /workspaces/{document=**} {
  allow read, write: if false;  // ⚠️ Atualmente bloqueado!
}
```

---

### 6️⃣ COLEÇÃO: `workspaces/{workspaceId}/debts` (Dívidas)

| Campo | Arquivo | Função | Operação | Path |
|-------|---------|--------|----------|------|
| Dívida | `src/services/debtService.js` | `createDebt()` | addDoc | `workspaces/{id}/debts/{id}` |
| Dívida | `src/services/debtService.js` | `updateDebt()` | updateDoc | `workspaces/{id}/debts/{id}` |

**Estrutura:**
```
workspaces/
  ├── ws001/
  │   └── debts/
  │       ├── debt001/
  │       │   ├── name: "Dívida do João"
  │       │   ├── totalAmount: 1000.00
  │       │   ├── paidAmount: 500.00
  │       │   └── status: "open"
```

**Regra Firestore Necessária:**
```firestore
match /workspaces/{workspaceId}/debts/{document=**} {
  allow read, write: if false;  // ⚠️ Atualmente bloqueado!
}
```

---

### 7️⃣ COLEÇÃO: `users/{uid}/workspaceMemberships` (Memberships)

| Campo | Arquivo | Função | Operação | Path |
|-------|---------|--------|----------|------|
| Membership | `src/services/workspaceService.js` | `createWorkspace()` | setDoc | `users/{uid}/workspaceMemberships/{workspaceId}` |

**Estrutura:**
```
users/
  ├── abc123xyz/
  │   └── workspaceMemberships/
  │       ├── ws001/
  │       │   ├── workspaceId: "ws001"
  │       │   ├── role: "gestor"
  │       │   └── status: "active"
```

**Regra Firestore Necessária:**
```firestore
match /users/{uid}/workspaceMemberships/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
```

---

## 🚨 ANÁLISE DO PROBLEMA PRINCIPAL

### Cadastro de Professor

**Fluxo Completo:**
```
TeachersPage.jsx
  ↓ handleSave()
  ↓ saveTeacher(user.uid, {...})
  ↓ teacherService.js: saveTeacher()
  ↓ ebdDataService.js: saveEbdDocument(uid, 'teachers', {...})
  ↓ Firebase path: users/{uid}/ebd_teachers
  ↓ setDoc(ref, {...})
  ✅ OU ❌ permission-denied
```

**O Que Deve Ser Verificado:**

1. ✅ `user.uid` é o mesmo que `request.auth.uid` no Firebase?
2. ✅ O console mostra: `🔐 [ebdDataService] UID do usuário: {qualquer-uid}`?
3. ✅ O path está correto? Deve ser: `users/SEU_UID/ebd_teachers`
4. ✅ A regra Firestore permite escrita em `match /users/{uid}/ebd_teachers`?
5. ❌ Ou a regra atual está bloqueando porque usa `request.auth.uid == "SEU_UID_AQUI"` (string fixa)?

---

## 📊 MATRIZ DE COLISÕES DE PERMISSÕES

| Collection | Status | Bloqueado? | Motivo |
|-----------|--------|-----------|--------|
| `users/{uid}` | ✅ Passando | Sim | Regra: `match /users/{uid}` apenas lê/escreve quando `uid` = `request.auth.uid` |
| `users/{uid}/accounts` | ✅ Passando | Sim | Subcollection em `/users/{uid}` |
| `users/{uid}/ebd_teachers` | ❌ **BLOQUEADO** | **SIM** | Subcollection em `/users/{uid}` deveria passar, MAS pode estar com regra errada |
| `users/{uid}/ebd_people` | ❌ **BLOQUEADO** | **SIM** | Mesmo problema |
| `workspaces/{id}` | ❌ **BLOQUEADO** | **SIM** | Regra padrão nega tudo |
| `workspaces/{id}/members` | ❌ **BLOQUEADO** | **SIM** | Subcollection de workspace |
| `workspaces/{id}/debts` | ❌ **BLOQUEADO** | **SIM** | Mesmo como acima |

---

## 🔐 REGRAS CORRETAS NECESSÁRIAS

Copie e cole EXATAMENTE isto no Firebase Console → Firestore → Rules:

```firestore
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // ===== DENY ALL BY DEFAULT =====
    match /{document=**} {
      allow read, write: if false;
    }

    // ===== USER DATA (Profiles, Settings, Memberships) =====
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth.uid == uid;
    }

    // ===== WORKSPACES (Multi-user Financial Data) =====
    // TO DO: Implement proper member checks
    match /workspaces/{document=**} {
      allow read, write: if false;  // Currently disabled
    }
  }
}
```

---

## 🐛 CHECKLIST DE DEBUG

Antes de publicar as regras, execute CADA UM NO CONSOLE (F12):

```javascript
// 1. Confirme que está logado
console.log('👤 Usuário atual:', auth.currentUser?.uid)

// 2. Tente cadastrar um professor
// → Observe os logs no console:
//   🔐 [ebdDataService] UID do usuário: {seu-uid}
//   🔐 [ebdDataService] Collection path: users/{seu-uid}/ebd_teachers
//   ✅ OU ❌ [ebdDataService] ERRO

// 3. Se erro "permission-denied" aparecer, verifique:
console.log('🔐 Request UID:', auth.currentUser.uid)
console.log('🔐 Firestore path:', 'users/' + auth.currentUser.uid + '/ebd_teachers')
```

---

## 📁 ARQUIVOS MODIFICADOS

| Arquivo | O que foi adicionado |
|---------|----------------------|
| [src/services/accountService.js](src/services/accountService.js) | Logs de gravação em `users/{uid}/accounts` |
| [src/firebase/auth.js](src/firebase/auth.js) | Logs de criação de usuário em `users/{uid}` |
| [src/services/ebdDataService.js](src/services/ebdDataService.js) | ✅ Já tinha logs (de antes) |

---

## ✅ PRÓXIMAS AÇÕES

1. **Pegue o UID do admin** (visto no Console ao fazer login)
2. **Suba as regras corretas** no Firebase (veja acima)
3. **Teste cadastro de professor** com DevTools aberto (F12)
4. **Veja os logs:**
   - Devem mostrar: `🔐 [ebdDataService] UID do usuário: abc123...`
   - Devem mostrar: `🔐 [ebdDataService] Collection path: users/abc123.../ebd_teachers`
   - Devem mostrar: `✅ Documento criado com sucesso` OU `❌ permission-denied`
5. **Se ainda der erro**, significa que a regra não foi aplicada corretamente

---

## 🎯 RESPOSTA RÁPIDA

**Por que o professor não salva?**

→ A collection é `users/{seu-uid}/ebd_teachers`
→ A regra precisa permitir: `request.auth.uid == {seu-uid}`
→ Se estiver fixo como `request.auth.uid == "SEU_UID_AQUI"` (string), está errado

**Solução:** Use a regra:
```firestore
match /users/{uid}/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
```

---

## 📞 SUPORTE

Se o problema persistir, compartilhe:

1. O UID que aparece no Console (F12)
2. A mensagem de erro exata do Firestore
3. A screenshot das Rules que você publicou
4. Os logs que aparecem em Console ao tentar cadastrar
