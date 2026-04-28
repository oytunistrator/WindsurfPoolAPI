IMAGE   := windsurfapi:local
COMPOSE := docker compose
APP     := windsurfapi

.PHONY: help build up down restart logs shell ps clean rebuild dev check

help: ## Bu yardım mesajını göster
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# ── Docker ────────────────────────────────────────────────────────────────────

build: ## Docker imajını local olarak derle
	$(COMPOSE) build --no-cache

up: ## Container'ı başlat (arka planda)
	$(COMPOSE) up -d

down: ## Container'ı durdur ve kaldır
	$(COMPOSE) down

restart: ## Container'ı yeniden başlat
	$(COMPOSE) restart $(APP)

rebuild: down build up ## Durdur → Derle → Başlat

logs: ## Canlı log akışı
	$(COMPOSE) logs -f $(APP)

logs-tail: ## Son 100 satır log
	$(COMPOSE) logs --tail=100 $(APP)

shell: ## Container içine bash aç
	$(COMPOSE) exec $(APP) sh

ps: ## Çalışan container durumu
	$(COMPOSE) ps

health: ## Health check endpoint'ini sorgula
	@curl -sf http://localhost:3003/health | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.stringify(JSON.parse(d),null,2))" || echo "❌ Servis cevap vermiyor"

# ── Geliştirme ────────────────────────────────────────────────────────────────

dev: ## Node.js'i watch modunda local çalıştır (Docker olmadan)
	node --watch src/index.js

check: ## Tüm JS dosyalarını sözdizimi kontrolünden geçir
	@find src -name '*.js' -type f -exec node --check {} + && echo "✅ Sözdizimi hatası yok"

install: ## npm bağımlılıklarını kur
	npm install

# ── Temizlik ──────────────────────────────────────────────────────────────────

clean: down ## Container + imajı sil
	docker rmi $(IMAGE) 2>/dev/null || true
	@echo "✅ Temizlendi"

tail: ## Uygulama log dosyasını canlı izle (logs/app.log)
	@tail -f logs/app.log 2>/dev/null || echo "❌ logs/app.log bulunamadı — uygulama başlatılmamış olabilir"

tail-cmd: ## Sadece TELEGRAM komut loglarını filtrele
	@tail -f logs/app.log 2>/dev/null | grep --line-buffered '\[TELEGRAM\]' || echo "❌ logs/app.log yok"

clean-logs: ## Log dosyalarını temizle
	@rm -rf logs/*.log logs/**/*.log 2>/dev/null; echo "✅ Loglar temizlendi"

prune: ## Kullanılmayan tüm Docker kaynaklarını temizle
	docker system prune -f
