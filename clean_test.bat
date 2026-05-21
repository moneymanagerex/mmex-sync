@echo off
call set_user_passwd.bat
mkdir samples\db_sample_1
mkdir samples\db_sample_2

del samples\db_sample_1\sample_db1.mmb
del samples\db_sample_2\sample_db2.mmb

echo create complete empty db 
copy test_db.mmb samples\db_sample_1\sample_db1.mmb

echo create second db 
node sync_core.js --db=samples\db_sample_2\sample_db2.mmb --create

echo clear server
node sync_core.js --clearServer

echo init db_sample_1
call samples\db_sample_1\mytest_core.bat

echo init db_sample_2
call samples\db_sample_2\mytest_core.bat
