# GOLD INTELLIGENCE AI — Python ML microservice
FROM python:3.12-slim
WORKDIR /srv

COPY backend-ml/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend-ml/ .

EXPOSE 8085
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8085"]
