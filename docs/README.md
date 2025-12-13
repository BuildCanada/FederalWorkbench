# Documentation

A Next.js chatbot for querying Canadian federal parliament proceedings and legislation. Uses dual RAG systems to retrieve relevant context from Open Parliament data and Justice Canada legislation XML.

## Quick Links

- [Development Guide](./development.md)
- [Environment Variables](../.env.example)
- [Docker Setup](../docker-compose.yml)

## RAG Systems

- [Parliament RAG](../lib/rag/parliament/README.md) - Retrieves bills, Hansard debates, votes, politicians, committees
- [Legislation RAG](../lib/rag/legislation/README.md) - Retrieves federal acts and regulations

## Scripts & Data

- [Scripts Reference](../scripts/README.md)
- [Parliament Data](../data/parliament/README.md)

## For AI Agents

- [Claude Code Guidelines](../CLAUDE.md)