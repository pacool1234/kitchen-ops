# Backup and restore tools for the production database: the weekly cron job in render.yaml and
# restore drills (docs/runbooks/restore.md).
# Postgres 18's own image, so pg_dump and pg_restore match the server: pg_dump refuses to dump a
# server newer than itself.
FROM postgres:18-alpine

# age encrypts; aws-cli uploads to Scaleway's S3-compatible storage; curl sends Sentry check-ins.
RUN apk add --no-cache age aws-cli curl

COPY aws-config /etc/aws/config
ENV AWS_CONFIG_FILE=/etc/aws/config

COPY backup.sh restore.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh

# The image's own user, not root. The image's entrypoint starts a Postgres server; this one doesn't.
USER postgres
ENTRYPOINT []
CMD ["backup.sh"]
