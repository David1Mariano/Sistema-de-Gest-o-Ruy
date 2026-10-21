// Retired browser credential store. Windows authentication uses the existing
// D1 backend with HttpOnly sessions; hosted auth uses the official adapter.
// Never migrate browser passwords, mint browser sessions or expose OTP codes.
const unavailable=async()=>{throw Object.assign(new Error('Autenticação no navegador desativada. Utilize o acesso individual pelo servidor configurado.'),{status:503});};
export const localAuth=Object.freeze({
 isAuthenticated:async()=>false,me:unavailable,loginViaEmailPassword:unavailable,
 loginWithProvider:unavailable,register:unavailable,resendOtp:unavailable,verifyOtp:unavailable,
 resetPasswordRequest:unavailable,resetPassword:unavailable,registerInitialAdmin:unavailable,
 setToken:unavailable,logout:unavailable,
 redirectToLogin:()=>{window.location.assign('/login');},
});
