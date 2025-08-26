---
categories:
  - homelab
  - vmware
date: 2020-12-11 19:29:30-05:00

title: Breaking your TKG cluster is easier than fixing it
url: /2020/12/18/fix-tkg-cluster/
---


Newer versions of ESXI (6.7U3+) can run [VMware's Tanzu Kubernetes Grid](https://tanzu.vmware.com/kubernetes-grid). I don't run ESXI HA at home, so unfortunately I don't get to take advantage of some shiny features, but it does some important stuff which is why it's the K8S I run at home:

- PVs are ESXI VMDKs, and can be placed on an iSCSI target (!)
  - You even get to see your PVs in VCSA
- It comes with a nifty CLI tool and some OVAs for load balancers and Kubernetes nodes
  - `tkg scale cluster foo --worker-machine-count=3` and it will do the thing

So, scale I did. But I realized I entered the `-c` flag instead, which gave me 3 control plane nodes instead of 3 workers. I thought my CTRL-C was fast, but we find ourselves here:

```
± % tkg get cluster
 NAME    NAMESPACE  STATUS         CONTROLPLANE  WORKERS  KUBERNETES        ROLES
 hubble  default    createStalled  0/1           0/0      v1.19.1+vmware.2  <none>
```

Yikes! `kubectl cluster-info` also times out. Mercifully we get to set an SSH keypair during initial cluster setup, so we can go check the master:

```
root [ /home/capv/etcd-v3.4.14-linux-amd64 ]# netstat -tunlp
Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 127.0.0.1:33201         0.0.0.0:*               LISTEN      3288/containerd
tcp        0      0 127.0.0.1:10257         0.0.0.0:*               LISTEN      1074/kube-controlle
tcp        0      0 127.0.0.1:10259         0.0.0.0:*               LISTEN      1118/kube-scheduler
tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      633/sshd
tcp        0      0 127.0.0.1:10248         0.0.0.0:*               LISTEN      4452/kubelet
tcp        0      0 127.0.0.1:2379          0.0.0.0:*               LISTEN      5533/etcd
tcp        0      0 10.0.5.155:2379         0.0.0.0:*               LISTEN      5533/etcd
tcp        0      0 10.0.5.155:2380         0.0.0.0:*               LISTEN      5533/etcd
tcp        0      0 127.0.0.1:2381          0.0.0.0:*               LISTEN      5533/etcd
tcp6       0      0 :::22                   :::*                    LISTEN      633/sshd
tcp6       0      0 :::10250                :::*                    LISTEN      4452/kubelet
udp        0      0 127.0.0.53:53           0.0.0.0:*                           527/systemd-resolve
udp        0      0 10.0.5.155:68           0.0.0.0:*                           525/systemd-network
```

No `kubelet` on 6443. How about the logs?

![](https://i.imgur.com/u23cCSCl.png)


The TKG nodes don't use Docker, but [containerd](https://containerd.io/) as their CRI directly. Digging in:

```
root [ ~ ]# ctr ns ls
NAME   LABELS
k8s.io

CONTAINER                                                           IMAGE                                                                                                                            RUNTIME
00358fc2eb33bfc80a807e0735c7d81f7a061c49f7016422fb8439a6ea4177d8    registry.tkg.vmware.run/pause:3.2                                                                                                io.containerd.runc.v1
0081f1ace653c9fb289450792de8c289236330fcd8c0711b4371800e775c7875    registry.tkg.vmware.run/pause:3.2                                                                                                io.containerd.runc.v1

# ...tons of containers
```

I don't know much about ctr, but have found out that a container does not necessarily have to be running. You probably want to look at tasks:

```
root [ ~ ]# ctr t ls
TASK                                                                PID     STATUS
92ad0a3638810bd5ff634151a8af06ac2914801f7c33e4e82100380f4b7c0f72    887     RUNNING
6e702ec6f6db7ff1cea3d2f6b708c211d8054a695a1d3fae25c46d1f87c127f0    3687    RUNNING
33ef0c078ce8dd698b45fcacef64a2e44424b14b198e3253af72ecc09bd8f8d7    4054    RUNNING
72a3b175cf064ee9c2514092b248cf12bd642ca08ef6066343dd879b23ad520a    4410    RUNNING
1554d1df12831f74ea6ed5ceeec72fef5e383f99e39b11acf6a13dd439810ea9    4818    RUNNING
d4d503babcb5d1cd98543c8907e329436fe63efbfb153ebf8cc057ffd56f590b    4917    RUNNING
abcb2c731a2faf377d2f28a4d36c632d8625f28a2b71a8e4c5955a86cec30ff5    1022    RUNNING
4907ae81490b7132571ae19b6169d737238da3565ea877edd6f386293d61319b    1087    RUNNING
d4492800b0fbe4a283c0917b9da02bbb187b694a6e1e07b6786de485200e36b6    2478    RUNNING
...
```

Unfortunately, I didn't finish this blogpost when I first sat down to do so and I didn't save scrollback. Sorry about that! However, the next few revelations were had by:

- `ctr t attach` to some running tasks. You may see some logs.
- The PIDs in the task column can be queried using `ps`. Find the one associated with `kube-apiserver`.
- From there, I was able to get logs saying `etcd` is unavailable.

K8S uses `etcd` to basically store all of its data. Corruption here could mean that your workloads and/or their configs can be lost. Generally, `etcdctl` is installed on Kube worker boxes but it doesn't come loaded in VMware's OVAs, so off we go to download it. You can find your `cert`, `cacert`, and `key` inside `/etc/kubernetes/pki`:

```
$ curl -OL https://github.com/etcd-io/etcd/releases/download/v3.4.14/etcd-v3.4.14-linux-amd64.tar.gz
$ tar -xvf etcd-v3.4.14-linux-amd64.tar.gz
$ cd etcd-v3.4.14-linux-amd64
$ ./etcdctl --endpoints=https://localhost:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/peer.crt --key=/etc/kubernetes/pki/etcd/peer.key member list
{"level":"warn","ts":"2020-12-12T01:32:24.220Z","caller":"clientv3/retry_interceptor.go:62","msg":"retrying of unary invoker failed","target":"endpoint://client-eafb9d39-0cf3-4b02-8c80-ba5a89582354/localhost:2379","attempt":0,"error":"rpc error: code = DeadlineExceeded desc = latest balancer error: all SubConns are in TransientFailure, latest connection error: connection error: desc = \"transport: Error while dialing dial tcp 127.0.0.1:2379: connect: connection refused\""}
Error: context deadline exceeded
```

Looks like etcd isn't up at all. 

At this point, it became a little clearer. Aborting during control plane scaling is very dangerous, as we ended up having _only two_ etcd nodes running. [The official docs](https://etcd.io/docs/v3.3.12/faq/#:~:text=Why%20an%20odd%20number%20of,of%20nodes%20necessary%20for%20quorum.) recommend always running an odd number of nodes to aid with quorum. Using the same technique above, we were able to tail some logs from the etcd containers. Due to the aforementioned scrollback issue I can't show the logs: but etcd failed to reach quorum.

So, now there's a complete overview:

- We stopped when deploying another controlplane node
- `kube-apiserver` can't go up because `etcd` is down
- `etcd` can't go up because of quorum issues and missing members (presumably from the 3 total requested controlplane nodes?)

### How do we fix it?

Begin by nuking all of your controlplane nodes except for one. **Keep your original master** if you can, presumably the new `etcd` replicas did not sync and you want to minimize the chance of data loss. Then, find the `etcd` manifest and add `--force-new cluster` to the `etcd` args:

`vim /etc/kubernetes/manifests/etcd.yaml`:

```yaml
spec:
  containers:
  - command:
    - etcd
    - --force-new-cluster
    - --cert-file=/etc/kubernetes/pki/etcd/server.crt
    # ...
```

Save and bounce all the `etcd` containers, wait a min, then try to start kubelet:

```
$ ctr c ls | grep etc | awk '{print $1}' | xargs -I {} ctr c rm {}
$ systemctl restart kubelet
```

If things don't come back to life restart the machine and let init bring everything else back up. If all is well, `kubectl cluster-info` should work again! Let's check that `etcd` health:

```
$ ./etcdctl --endpoints=https://localhost:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/peer.crt --key=/etc/kubernetes/pki/etcd/peer.key member list
82ea945b499897fe, started, hubble-control-plane-26gpw, https://10.0.5.155:2380, https://10.0.5.155:2379, false
```

Great! But we're not done yet; if you want to run the cluster with multiple control planes we are going to need to remove the `--force-new-cluster` flag. Edit it and kill all of your etcd pods (or reboot the master again). Everything should come back up as expected.

### Bonus: DHCP troubles

During the initial install, you can specify `--vsphere-controlplane-endpoint-ip`, which according to the docs is a static IP for your master:

```
If you are deploying Tanzu Kubernetes clusters to vSphere, each cluster requires one static virtual IP address to provide a stable endpoint for Kubernetes. Make sure that this IP address is not in the DHCP range, but is in the same subnet as the DHCP range. For more information, see Load Balancers for vSphere.
```

This is fine, but there are some issues with the implementation:
- `/etc/sysconfig/network` and friends are blank -- so there's no static IP definition on boot.
- The VM if placed in the subnet will get an IP from DHCP
- **The manifests** will now reference the DHCP IP!

For a headache free install, I recommend waiting for `tkg` to put up the control plane, then stopping it in VCSA and quickly adding a static lease for the same IP provided to `--vsphere-controlplane-endpoint-ip`. It will save you a ton of headaches.