# infra/coolify — cấu hình Coolify (không chứa secret)

Quy trình từng bước cho người: [`docs/runbooks/staging.md`](../../docs/runbooks/staging.md). Lý do chọn mô hình: [`docs/adr/0001-staging-deploy-coolify-compose.md`](../../docs/adr/0001-staging-deploy-coolify-compose.md).

| File                          | Là gì                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staging/docker-compose.yml`  | Resource Coolify `kb-staging` (build pack Docker Compose): `kb-migrate` → `kb-collab` → `kb-web`, image GHCR theo `KB_IMAGE_TAG`, label Traefik (collab public chỉ `/` + `/health`) |
| `staging/env.example`         | Biến cần đặt trong Coolify cho resource trên, lấy giá trị từ đâu                                                                                                                    |
| `proxy/dynamic/origin-ca.yml` | Cấu hình động Traefik: chứng chỉ Cloudflare Origin CA làm default certificate                                                                                                       |

Liên quan: `infra/scripts/firewall-cloudflare.sh` (firewall máy chủ), `.github/workflows/deploy.yml` + `scripts/deploy/coolify.mjs` (deploy qua API Coolify).

Kiểm tra file compose trước khi commit (cần biến giả vì `${VAR:?}` là bắt buộc):

```bash
cd infra/coolify/staging
KB_IMAGE_TAG=x MIGRATE_DATABASE_URL=x COLLAB_DATABASE_URL=x SUPABASE_JWT_SECRET=x \
COLLAB_INTERNAL_SECRET=x SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x docker compose config --quiet
```
