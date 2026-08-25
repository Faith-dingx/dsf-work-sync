#!/usr/bin/env python3
"""9888 模型列表刷新脚本（完整版，2026-08-20 修复 Bug#3）
用两种来源合并得到真实可调用全集：
  1) /v1/models（精选子集，可能含已废弃裸 id，仅作补充）
  2) chat/completions 探测法：故意调未知模型，解析 400 错误里的「可用: [...]」权威列表
合并去重写入 .temp/9888-models.json（带时间戳）。只读/探测，低频率，不触发限流。

健壮性（Bug#3 修复）：
  - /v1/models 失败不致命（warn 后忽略）
  - 探测法失败（网关不可达 / 返回格式变化 / 列表不可知）→ 保留旧表不覆盖，退出码 1
  - 最终表只保留带厂商前缀的 id（裸 id 已被 9888 废弃，chat/completions 返回 400）
"""
import urllib.request, urllib.error, json, time, os, sys, re

def load_key():
    try:
        import yaml
        cred = yaml.safe_load(open(os.path.expanduser('~/.dsh/.credentials.yaml')))
    except Exception:
        return ''
    def find(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if 'OPENCODE_GO' in str(k) and isinstance(v, str) and len(v) > 8:
                    return v
                r = find(v)
                if r:
                    return r
        return None
    return find(cred) or ''

KEY = load_key()
BASE = 'http://10.10.10.2:9888'

def get_models_list():
    """/v1/models 精选子集；失败抛异常，由 main 捕获。"""
    req = urllib.request.Request(BASE + '/v1/models', headers={'Authorization': 'Bearer ' + KEY})
    d = json.load(urllib.request.urlopen(req, timeout=15))
    return sorted(m['id'] for m in d.get('data', []))

def probe_full_list():
    """调未知模型，解析 400 错误中的可用列表（权威可调用全集）。

    返回：
      - list（非空）: 解析到可用列表
      - []         : 探测调用意外成功（网关接受了 __probe__），列表不可知
      - None       : 连接失败 / 超时 / 返回格式变化（未匹配「可用: [...]」）
    """
    body = json.dumps({'model': '__probe__', 'messages': [{'role': 'user', 'content': 'hi'}], 'max_tokens': 8}).encode()
    req = urllib.request.Request(BASE + '/v1/chat/completions', data=body,
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY})
    try:
        urllib.request.urlopen(req, timeout=20)
        return []  # 意外成功，列表不可知
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors='replace')
        m = re.search(r'可用:\s*(\[[^\]]*\])', msg)
        if m:
            return sorted(x.strip().strip("'\"") for x in m.group(1).strip('[]').split(','))
        # HTTP 400 但格式没匹配上：格式变化，不当作"空列表"静默退化
        return None
    except Exception:
        return None  # 网络/超时等

def main():
    # 1) /v1/models 精选子集：失败不致命
    v1 = []
    try:
        v1 = get_models_list()
    except Exception as e:
        print(f'WARN: /v1/models 获取失败（忽略）: {e}', file=sys.stderr)

    # 2) 探测法权威全集：唯一可信来源，失败/不可知则保留旧表不覆盖
    probe = probe_full_list()
    if not probe:
        print('ERROR: 探测法未能获取可用列表（网关不可达/格式变化/不可知），保留旧表不覆盖', file=sys.stderr)
        return 1

    # 3) 合并去重，只保留带厂商前缀的 id（裸 id 已废弃，chat/completions 400）
    models = sorted({m for m in (set(v1) | set(probe)) if '/' in m})
    out = {
        'updated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'count': len(models),
        'models': models,
    }
    os.makedirs('/home/dingx/DSF-work/.temp', exist_ok=True)
    with open('/home/dingx/DSF-work/.temp/9888-models.json', 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f'OK: {len(models)} models -> .temp/9888-models.json')
    return 0

if __name__ == '__main__':
    sys.exit(main())
