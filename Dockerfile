FROM node:18

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy TypeScript config
COPY tsconfig.json ./

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

EXPOSE 8080

# Start the application
CMD ["npm", "start"]