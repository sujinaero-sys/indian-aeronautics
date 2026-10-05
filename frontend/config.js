// ===== The only file you edit after deploying the Apps Script web app =====
window.IA = {
  api: 'https://script.google.com/macros/s/AKfycbxjEuTEPSDl0p4oVQ2XRw6LIkgdDCTxTAwqgUDDihzaRYZx9uN3YjhMn3pNdlmsCl7E3Q/exec',   // https://script.google.com/macros/s/XXXX/exec
  email: 'info@buye.online', whatsapp: '919995863184', whatsappDisplay: '+91 9995863184',
  razorpayCheckout: true,
};
window.IA.wa = (msg) => 'https://wa.me/' + IA.whatsapp + '?text=' + encodeURIComponent(msg || 'Hello Indian Aeronautics Support, I need assistance with IA.BUYE.ONLINE.');





