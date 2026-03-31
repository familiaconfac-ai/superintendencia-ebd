// Helpers de controle de acesso para EBD
// Uso: import { isAdmin, isTeacher, canAccessClass, canEditClass, canAccessNotebook } from './accessControlHelpers';

export function isAdmin(userProfile) {
  return userProfile?.role === 'admin';
}

export function isTeacher(userProfile) {
  return userProfile?.role === 'teacher';
}

export function canAccessClass(userProfile, classItem, authUser) {
  if (isAdmin(userProfile)) return true;
  if (isTeacher(userProfile)) {
    // Permite acesso se o professor for responsável pela classe
    return (
      classItem?.teacherEmail === authUser?.email ||
      (classItem?.teacherUid && classItem.teacherUid === authUser?.uid)
    );
  }
  return false;
}

export function canEditClass(userProfile, classItem, authUser) {
  // Só admin pode editar classes
  return isAdmin(userProfile);
}

export function canAccessNotebook(userProfile, notebook, authUser) {
  // notebook deve ter teacherEmail ou teacherUid
  if (isAdmin(userProfile)) return true;
  if (isTeacher(userProfile)) {
    return (
      notebook?.teacherEmail === authUser?.email ||
      (notebook?.teacherUid && notebook.teacherUid === authUser?.uid)
    );
  }
  return false;
}
