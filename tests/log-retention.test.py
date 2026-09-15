import importlib.util
import pathlib
import unittest
spec=importlib.util.spec_from_file_location('retention',pathlib.Path(__file__).parents[1]/'deploy/configure-log-retention.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RetentionTests(unittest.TestCase):
 def test_daily_age_based_and_idempotent(self):
  original='/var/log/nginx/*.log {\n daily\n rotate 14\n missingok\n notifempty\n compress\n create 0640 www-data adm\n postrotate\n  invoke-rc.d nginx rotate >/dev/null 2>&1\n endscript\n}\n'
  result=m.rotation_config(original)
  for value in ['daily','rotate -1','maxage 200','minage 1','create 0640 www-data adm','invoke-rc.d nginx rotate']:self.assertIn(value,result)
  self.assertEqual(result,m.rotation_config(result))
 def test_reject_size_shortcuts(self):
  with self.assertRaises(ValueError):m.rotation_config('/var/log/test {\n daily\n rotate 14\n maxsize 1M\n}')
 def test_minimal_format(self):
  result=m.nginx_config('http {\n access_log /var/log/nginx/access.log;\n}')
  self.assertEqual(result,m.nginx_config(result))
  self.assertIn('"path":"$uri"',result)
  for value in ['$request_uri','$request_body','$args','$http_cookie','$http_referer']:self.assertNotIn(value,result)
 def test_system_scope(self):
  original='/var/log/syslog\n/var/log/kern.log\n/var/log/auth.log\n/var/log/mail.log\n{\n weekly\n rotate 4\n compress\n postrotate\n  /usr/lib/rsyslog/rsyslog-rotate\n endscript\n}\n'
  result=m.rsyslog_config(original)
  ordinary,security=result.split('# NNU security logs: 200 days\n')
  self.assertIn('rotate 4',ordinary);self.assertIn('/var/log/mail.log',ordinary)
  self.assertNotIn('/var/log/mail.log',security);self.assertIn('maxage 200',security)
  self.assertEqual(result,m.rsyslog_config(result))
if __name__=='__main__':unittest.main()
