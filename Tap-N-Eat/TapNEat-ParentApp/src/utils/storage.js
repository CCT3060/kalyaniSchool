import AsyncStorage from '@react-native-async-storage/async-storage';

export async function getItem(key) {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setItem(key, value) {
  try {
    await AsyncStorage.setItem(key, String(value));
  } catch {}
}

export async function removeItem(key) {
  try {
    await AsyncStorage.removeItem(key);
  } catch {}
}

export async function getParentAuth() {
  const [email, name, schoolLogoUrl, schoolName] = await Promise.all([
    getItem('parentEmail'),
    getItem('parentName'),
    getItem('parentSchoolLogoUrl'),
    getItem('parentSchoolName'),
  ]);
  return {
    email: email || '',
    name: name || 'Parent',
    schoolLogoUrl: schoolLogoUrl || '',
    schoolName: schoolName || '',
  };
}

export async function setParentAuth(email, name, schoolLogoUrl = '', schoolName = '') {
  await Promise.all([
    setItem('parentEmail', email),
    setItem('parentName', name),
    setItem('parentSchoolLogoUrl', schoolLogoUrl || ''),
    setItem('parentSchoolName', schoolName || ''),
  ]);
}

export async function clearParentAuth() {
  await Promise.all([
    removeItem('parentEmail'),
    removeItem('parentName'),
    removeItem('parentSchoolLogoUrl'),
    removeItem('parentSchoolName'),
  ]);
}
