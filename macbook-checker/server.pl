#!/usr/bin/perl
# MacBook Checker — servidor local mínimo (só módulos que já vêm no Perl do macOS).
# Serve a página em http://127.0.0.1 (libera câmera/microfone) e roda os testes
# que o navegador não consegue fazer sozinho. Só aceita conexões deste Mac.
use strict;
use warnings;
use utf8;
use IO::Socket::INET;
use IO::Handle;
use JSON::PP;
use Encode ();
use POSIX ();
use Time::HiRes qw(time sleep);

my ($DIR, $PORT) = @ARGV;
$DIR  ||= '.';
$PORT ||= 8765;

my %MIME = (
  html => 'text/html; charset=utf-8', js => 'application/javascript; charset=utf-8',
  css => 'text/css; charset=utf-8', json => 'application/json', png => 'image/png', svg => 'image/svg+xml',
);
my $JSON = JSON::PP->new->utf8->canonical;

sub sh {
  my $o = `$_[0] 2>/dev/null`;
  $o = '' unless defined $o;
  return Encode::decode('UTF-8', $o, Encode::FB_DEFAULT);
}

sub has_cmd { return system("command -v $_[0] >/dev/null 2>&1") == 0 }

# ---------- testes ----------
sub t_power {
  return { batt => sh('pmset -g batt'), ac => sh('pmset -g ac') };
}

sub t_usb {
  return { json => sh('system_profiler -json SPUSBDataType SPUSBHostDataType') };
}

sub t_panics {
  my $home = $ENV{HOME} || '';
  my @dirs = ('/Library/Logs/DiagnosticReports', '/Library/Logs/DiagnosticReports/Retired',
              "$home/Library/Logs/DiagnosticReports", "$home/Library/Logs/DiagnosticReports/Retired");
  my (@panics, $crashes, $readable);
  $crashes = 0; $readable = 0;
  for my $d (@dirs) {
    opendir(my $dh, $d) or next;
    $readable++;
    for my $n (readdir $dh) {
      next if $n =~ /^\./;
      my $mt = (stat "$d/$n")[9] || 0;
      if ($n =~ /\.panic$|^panic|kernel/i) { push @panics, { name => $n, time => $mt } }
      elsif ($n =~ /\.(ips|crash)$/) { $crashes++ }
    }
    closedir $dh;
  }
  @panics = sort { $b->{time} <=> $a->{time} } @panics;
  my $setup = (stat '/var/db/.AppleSetupDone')[9];
  return {
    panics => \@panics, crashes => $crashes, readable => $readable,
    setupDone => $setup, now => time,
    reboots => sh('last reboot shutdown | head -15'),
  };
}

sub t_ssd {
  my $tmpdir = $ENV{TMPDIR} || '/tmp';
  my $size  = 2 * 1024 ** 3;          # 2 GB
  my $chunk = 16 * 1024 * 1024;       # 16 MB
  my @df = split ' ', (split /\n/, sh("df -k '$tmpdir'"))[-1] || '';
  my $free = ($df[3] && $df[3] =~ /^\d+$/) ? $df[3] * 1024 : 0;
  return { error => 'Pouco espaço livre no disco (precisa de uns 4 GB).' } if $free && $free < 2 * $size;

  my $buf = join '', map { chr int rand 256 } 1 .. 65536;
  $buf x= $chunk / 65536;
  my $file = "$tmpdir/mbc-ssd-$$.bin";
  open my $fh, '>:raw', $file or return { error => "Não consegui criar o arquivo: $!" };
  my $t0 = time;
  my $w = 0;
  while ($w < $size) { my $n = syswrite($fh, $buf); last unless $n; $w += $n }
  $fh->sync;
  my $wt = time - $t0;
  close $fh;
  unlink $file;
  return { error => 'A gravação falhou no meio.' } if $w < $size;
  return { mb => $w / 1e6, secs => $wt, mbps => $w / 1e6 / $wt };
}

sub t_wifi {
  return { error => 'Este macOS não tem o networkQuality (precisa do macOS 12 ou mais novo).' } unless has_cmd('networkQuality');
  return { json => sh('networkQuality -s -c') };
}

sub t_stress {
  my ($q) = @_;
  my ($s) = ($q || '') =~ /s=(\d+)/;
  $s ||= 90; $s = 180 if $s > 180;
  my ($n) = sh('sysctl -n hw.ncpu') =~ /(\d+)/;
  ($n) = sh('nproc') =~ /(\d+)/ unless $n;
  $n ||= 4;
  my $before = sh('pmset -g therm');
  my $end = time + $s;
  for (1 .. $n) {
    my $pid = fork;
    if (defined $pid && $pid == 0) {
      my $x = 0;
      while (time < $end) { $x += sqrt($_) for 1 .. 20000 }
      POSIX::_exit(0);
    }
  }
  sleep $s + 0.5;
  return { cpus => $n, secs => $s, before => $before, after => sh('pmset -g therm') };
}

my %API = (
  ping => sub { { ok => JSON::PP::true } },
  power => \&t_power, usb => \&t_usb, panics => \&t_panics,
  ssd => \&t_ssd, wifi => \&t_wifi, stress => \&t_stress,
);

# ---------- HTTP ----------
sub respond {
  my ($c, $code, $type, $body) = @_;
  my %txt = (200 => 'OK', 400 => 'Bad Request', 404 => 'Not Found', 500 => 'Error');
  print $c "HTTP/1.1 $code $txt{$code}\r\nContent-Type: $type\r\nContent-Length: " . length($body)
         . "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n" . $body;
}

sub handle {
  my ($c) = @_;
  binmode $c;
  my $req = <$c>;
  return unless defined $req;
  while (my $l = <$c>) { last if $l =~ /^\r?\n$/ }
  my ($path) = $req =~ m{^GET\s+(\S+)};
  return respond($c, 400, 'text/plain', 'bad request') unless $path;
  my $q = '';
  ($path, $q) = split /\?/, $path, 2;

  if ($path =~ m{^/api/(\w+)$}) {
    my $f = $API{$1} or return respond($c, 404, 'text/plain', 'not found');
    my $data = eval { $f->($q) } || { error => "$@" };
    return respond($c, 200, 'application/json', $JSON->encode($data));
  }
  $path = '/index.html' if $path eq '/';
  $path =~ s/%([0-9A-Fa-f]{2})/chr hex $1/ge;
  return respond($c, 404, 'text/plain', 'not found') if $path =~ /\.\./ || $path !~ m{^/[\w.\-/]+$};
  my $file = "$DIR$path";
  return respond($c, 404, 'text/plain', 'not found') unless -f $file;
  open my $fh, '<:raw', $file or return respond($c, 500, 'text/plain', 'error');
  my $body = do { local $/; <$fh> };
  my ($ext) = $file =~ /\.(\w+)$/;
  respond($c, 200, $MIME{$ext || ''} || 'application/octet-stream', $body);
}

my $srv = IO::Socket::INET->new(
  LocalAddr => '127.0.0.1', LocalPort => $PORT, Proto => 'tcp', Listen => 20, ReuseAddr => 1,
) or die "Não consegui abrir a porta $PORT: $!\n";

$SIG{CHLD} = 'IGNORE';
$SIG{PIPE} = 'IGNORE';
while (1) {
  my $c = $srv->accept or next;
  my $pid = fork;
  if (!defined $pid) { close $c; next }
  if ($pid == 0) { close $srv; $SIG{CHLD} = 'DEFAULT'; eval { handle($c) }; close $c; POSIX::_exit(0) }
  close $c;
}
