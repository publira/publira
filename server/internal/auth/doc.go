// Package auth issues and verifies the HS256 JWTs the APIs and the image
// routes authenticate with, and hashes the passwords and tokens beside them.
//
// A token's audience is what it may be presented to, and every verifier
// compares it exactly. public, admin, and platform are the access tokens of
// the three API namespaces; media and admin-media ride on an image URL; the
// four MFA audiences are the challenge a correct password earns while a second
// factor is still owed, which mfaflow spends. A token issued to a person
// carries the credentials_version of their users or platform_users row, which a
// password change increments, so the change ends every token issued before it.
//
// # Tokens on an image URL
//
// A browser cannot put an Authorization header on an <img> request, so a body
// image URL carries its credential in the [MediaTokenQueryParam] query
// instead. Such a token says who is asking and nothing more: the image routes
// decide what it opens on every request, and the eid claim limits it to the
// one episode it was issued for. Three kinds are issued:
//
//   - A reader's media token, which GetEpisodeDetail puts on the body image
//     URLs of an episode the reader may view. It lives [MediaTokenTTL], and
//     the image routes read the reader's purchases and access tickets each
//     time under the same rules as the API.
//   - The media token of a free body — price 0, or a priced episode inside an
//     open free window — whose reader may hold no credential at all and still
//     needs key material for the encrypted body. It names
//     [FreeEpisodeMediaSubject] rather than a reader, its iat is the start of
//     the current [FreeEpisodeMediaTokenWindow], and it lives two windows, so
//     a token in hand always has one whole window left and every reader of one
//     free episode inside one window is handed the identical URL. There is no
//     reader to revoke; rotation is what ends a copied URL. Access is still
//     the public rule alone, so an unpublished episode and a paid one without
//     a grant answer 403 whether the token is there or not.
//   - The admin-media token of a tenant member, which the console's episode
//     image RPCs put on the previews they answer. It lives [MediaTokenTTL],
//     unlocks nothing on a tenant site, and does not pass to the admin API. On
//     a console host the image routes check the tenant membership and the
//     admin role each time, and never the publication state or the price.
package auth
