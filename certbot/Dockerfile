FROM certbot/certbot:latest

RUN apk add --no-cache docker-cli

COPY deploy-hook.sh /deploy-hook.sh
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /deploy-hook.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
