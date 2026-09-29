import { SocialProvider } from './providerBase.mjs';
import { ManyChatProvider } from './manychat.mjs';
export { SocialError, SocialProvider } from './providerBase.mjs';
// Documented potential capabilities, NOT granted permissions or live connections.
const metaCapabilities = { connect: true, listComments: true, replyComment: true, listPosts: true, getInsights: true, refresh: true };
export class InstagramProvider extends SocialProvider { constructor() { super('instagram', { ...metaCapabilities }); } }
export class FacebookProvider extends SocialProvider { constructor() { super('facebook', { ...metaCapabilities }); } }
export class TikTokProvider extends SocialProvider {
  constructor() { super('tiktok', { connect: true, listComments: false, replyComment: false, listPosts: true, getInsights: false, refresh: true }); }
}
export const providers = Object.freeze({ instagram: new InstagramProvider(), facebook: new FacebookProvider(), tiktok: new TikTokProvider() });
// Transports are separate from channels: do not store provider=manychat in comments.
export const transports = Object.freeze({ manychat: new ManyChatProvider() });
