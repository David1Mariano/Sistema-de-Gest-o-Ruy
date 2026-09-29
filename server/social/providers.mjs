import { SocialProvider } from './providerBase.mjs';
import { ManyChatProvider } from './manychat.mjs';
export { SocialError, SocialProvider } from './providerBase.mjs';
// Documented potential capabilities, NOT granted permissions or live connections.
const metaCapabilities = { connect: true, listComments: true, replyComment: true, listPosts: true, getInsights: true, refresh: true };
export class InstagramProvider extends SocialProvider { constructor() { super('instagram', { ...metaCapabilities }); } }
export class FacebookProvider extends SocialProvider { constructor() { super('facebook', { ...metaCapabilities }); } }
// WhatsApp é canal, e como os outros: entra pela API oficial. Não é atalho
// para ManyChat nem um proxy de conversa livre.
export class WhatsAppProvider extends SocialProvider {
  constructor() { super('whatsapp', { connect: true, listComments: true, replyComment: true, listPosts: false, getInsights: false, refresh: true }); }
}
export class TikTokProvider extends SocialProvider {
  constructor() { super('tiktok', { connect: true, listComments: false, replyComment: false, listPosts: true, getInsights: false, refresh: true }); }
}
export const providers = Object.freeze({
  instagram: new InstagramProvider(), facebook: new FacebookProvider(),
  whatsapp: new WhatsAppProvider(), tiktok: new TikTokProvider(),
});
// Transports are separate from channels: do not store provider=manychat in comments.
// ManyChat é OPCIONAL: existe, continua testado e funciona, mas a Central não
// depende dele. Instagram/Facebook/WhatsApp conversam com as APIs oficiais
// diretamente, e o ManyChat é só mais um caminho quando o dono configurar.
export const transports = Object.freeze({ manychat: new ManyChatProvider() });
export const TRANSPORT_ROLES = Object.freeze({ manychat: 'optional' });
