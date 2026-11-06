# ALTUG KUYUMCULUK - Fiyat Toplama Hizmeti Konteyneri
# Cloud Run icin. Node.js KULLANICININ BILGISAYARINA KURULMAZ;
# bu imaj Google Cloud Build tarafında (bulutta) oluşturulur.
FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.js harem-map.js firebase-writer.js ./

# Cloud Run zorunlu saglik kontrolu portu
ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
