@echo off
node %~dp0\..\..\src\index.js --db=%~dp0\sample_db1.mmb --profile=db_sample_1 %*
