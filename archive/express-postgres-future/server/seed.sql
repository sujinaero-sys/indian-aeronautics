INSERT INTO plans(id,name,price_paise,duration_days,tax_pct,features,limits) VALUES
 ('free','Free',0,365,18,'{basic_profile}','{"enquiries":10}'),
 ('professional','Professional',499900,365,18,'{basic_profile,enhanced_profile,rfq_access,analytics}','{}'),
 ('business','Business',1499900,365,18,'{basic_profile,enhanced_profile,rfq_access,analytics,lead_mgmt,priority,multi_user}','{}'),
 ('enterprise','Enterprise',0,365,18,'{basic_profile,enhanced_profile,rfq_access,analytics,lead_mgmt,priority,multi_user,intelligence,api,support}','{}') ON CONFLICT DO NOTHING;
INSERT INTO email_templates(key,subject,body) VALUES
 ('email_verification','Your Indian Aeronautics verification code','Hello {{name}},\n\nYour verification code is {{code}}. It expires in 15 minutes.\n\nSupport: {{support_email}} | WhatsApp {{whatsapp}}'),
 ('password_reset','Reset your Indian Aeronautics password','Hello {{name}},\n\nUse this code to reset your password: {{code}} (expires in 15 minutes). If you did not ask for this, ignore this email.\n\nSupport: {{support_email}}'),
 ('company_invitation','You have been invited to join {{company}} on IA.BUYE.ONLINE','Hello {{name}},\n\nYou have been invited to join {{company}} on IA.BUYE.ONLINE.\nAccept here (valid 7 days): {{link}}\n\nSupport: {{support_email}}'),
 ('payment_success','Payment received — {{invoice}}','Hello {{name}},\n\nYour payment is confirmed and your plan is active. Invoice: {{invoice}}.\n\nSupport: {{support_email}} | WhatsApp {{whatsapp}}'),
 ('payment_failure','Your payment did not go through','Hello {{name}},\n\nYour payment failed. No plan change was made. Please try again or contact {{support_email}} / WhatsApp {{whatsapp}}.')
ON CONFLICT DO NOTHING;
