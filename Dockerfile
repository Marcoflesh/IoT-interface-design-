# Servidor web para la página del monitoreo de calidad del agua.
# nginx sirve la carpeta docs/ (la misma que publica GitHub Pages).
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docs/ /usr/share/nginx/html/

EXPOSE 80
