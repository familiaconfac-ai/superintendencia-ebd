# 🔐 CONFIGURAÇÃO DE REGRAS DO FIRESTORE - PASSO A PASSO

## PASSO 1️⃣: PEGUE O UID DO ADMIN

### A. Abra o DevTools do seu navegador
```
Pressione: F12
Vá para a aba: Console
```

### B. Faça login no app EBD
- Faça login com sua conta de admin

### C. Procure no Console por:
```
👤 [FIRESTORE RULES] UID DO ADMIN: abc123def456ghi789jkl
👤 [FIRESTORE RULES] EMAIL: seu-email@exemplo.com
```

### D. Copie o UID
```
Exemplo: abc123def456ghi789jkl
```

---

## PASSO 2️⃣: SUBSTITUA O UID NAS REGRAS

Procure por: `"SEU_UID_AQUI"`

Substitua por: Seu UID real (sem aspas)

**Antes:**
```firestore
match /professores/{document=**} {
  allow read: if request.auth != null;
  allow write: if request.auth.uid == "SEU_UID_AQUI";
}
```

**Depois:**
```firestore
match /professores/{document=**} {
  allow read: if request.auth != null;
  allow write: if request.auth.uid == "abc123def456ghi789jkl";
}
```

---

## PASSO 3️⃣: COLE AS REGRAS NO FIREBASE

### A. Abra Firebase Console
```
https://console.firebase.google.com/
```

### B. Selecione seu projeto EBD

### C. Vá para: Firestore Database → Rules (aba)

### D. Apague tudo que tiver lá

### E. Cole O CÓDIGO ABAIXO (com seu UID já substituído):

```firestore
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // 1. REGRA PADRÃO: Nega tudo
    match /{document=**} {
      allow read, write: if false;
    }

    // 2. COLEÇÃO: professores
    // - Leitura: para qualquer usuário autenticado
    // - Escrita: apenas para o admin (UID específico)
    match /professores/{document=**} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == "abc123def456ghi789jkl";
    }

    // 3. COLEÇÃO: usuarios
    // - Leitura e Escrita: apenas para usuários autenticados
    // - Cada usuário só acessa seus próprios dados
    match /usuarios/{uid}/{document=**} {
      allow read, write: if request.auth.uid == uid;
    }

  }
}
```

### F. Clique em PUBLISH

Aguarde a mensagem: ✅ "Rules updated successfully"

---

## 📊 O QUE CADA REGRA FAZ

| Coleção | Quem lê | Quem escreve | Descrição |
|---------|---------|--------|-----------|
| `professores` | Autenticados | Apenas admin | Qualquer usuário logado vê professores, mas só o admin pode criar/editar/deletar |
| `usuarios/{uid}/*` | Só o próprio usuário | Só o próprio usuário | Cada usuário acessa apenas seus dados |
| Tudo mais | Ninguém | Ninguém | Segurança padrão: nega por padrão |

---

## 🔐 ESTRUTURA USADA

```
Firestore (raiz)
├── professores/
│   ├── prof_001/
│   │   ├── fullName: "João Silva"
│   │   ├── phone: "11999999"
│   │   └── ...
│   └── prof_002/
│       └── ...
│
└── usuarios/
    └── {uid}/
        ├── profile/
        └── settings/
```

---

## ✅ COMO TESTAR AS REGRAS

### 1. Após publicar, volte ao app e teste:

**Teste 1: Leitura de professores**
```
✅ Deve conseguir VER a lista de professores
(Qualquer usuário autenticado)
```

**Teste 2: Escrita de professores (COM ADMIN)**
```
✅ Deve conseguir CRIAR novo professor
(Apenas com seu UID específico)
```

**Teste 3: Escrita de professores (COM OUTRO USUÁRIO)**
```
❌ Deve BLOQUEAR com erro "permission-denied"
(Outro UID diferente do admin)
```

### 2. Verifique o Console (F12)
```
✅ [ebdDataService] Documento criado com sucesso
ou
❌ [ebdDataService] ERRO ao criar documento: permission-denied
```

---

## 🐛 SE NÃO FUNCIONAR

### Erro: "Missing or insufficient permissions"

**Causa provável:** UID está errado ou as rules não foram publicadas

**Solução:**
1. ✅ Verifique se copiar o UID corretamente
2. ✅ Verifique a sintaxe das rules (sem erros de digitação)
3. ✅ Aguarde 2-3 minutos após publicar
4. ✅ Limpe o cache do browser (Ctrl+Shift+Delete)
5. ✅ Faça logout e login novamente no app

---

## 📋 RESUMO RÁPIDO

| Etapa | Ação | Onde |
|-------|------|------|
| 1 | Abra F12 e veja o UID | Console do browser |
| 2 | Copie o UID exato | `👤 [FIRESTORE RULES] UID DO ADMIN:` |
| 3 | Substitua "SEU_UID_AQUI" | Cole nas rules |
| 4 | Cole as rules completas | Firebase Console → Firestore → Rules |
| 5 | Clique PUBLISH | Aguarde confirmação verde ✅ |
| 6 | Teste no app | Tente cadastrar professor |

---

## 🎯 ARQUIVO DE REFERÊNCIA

Um arquivo `firestore-rules-config.txt` foi criado no projeto com as regras prontas.

---

## 📞 SUPORTE

Se precisar entender as rules:

- `request.auth != null` → Usuário está autenticado?
- `request.auth.uid == "..."` → UID do usuário é este?
- `allow read` → Permite LER documentos
- `allow write` → Permite CRIAR/EDITAR/DELETAR documentos
- `{document=**}` → Aplica a TODAS as subcoleções

---

## ✨ PRONTO!

Depois que publicar, o app EBD terá:
- ✅ Qualquer usuário autenticado pode VER professores  
- ✅ Apenas o admin pode GERENCIAR professores
- ✅ Cada usuário acessa apenas seus dados na coleção usuarios
- ✅ Segurança máxima com UID como critério
