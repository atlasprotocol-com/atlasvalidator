#!/bin/bash
set -e

git pull

npm ci
pm2 start ecosystem.config.js
pm2 reload ecosystem.config.js