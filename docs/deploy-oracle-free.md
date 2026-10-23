# Free hosting on Oracle Cloud

Run the whole stack (Postgres with pgvector, Redis, the API, the worker and Caddy with HTTPS) on one Oracle Cloud **Always Free** ARM virtual machine, with a free DuckDNS hostname. Nothing here costs money as long as you stay within the Always Free limits.

| You get | Limit |
| --- | --- |
| Ampere A1 VM | 2 OCPUs and 12 GB of RAM in total (since June 2026) |
| Disk | 200 GB of boot and block volumes |
| Outbound traffic | 10 TB per month |

Why not a free platform tier instead? Omni.io needs a background worker and a database that persists. Render's free plan, for example, has no background workers, deletes free Postgres databases after 30 days, and sleeps after 15 minutes. A free VM runs everything with no such limits.

## 1. Create the Oracle Cloud account

Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/).

- Oracle asks for a card to verify identity. Always Free resources aren't charged.
- **Choose your home region carefully.** It can't be changed later, and Always Free ARM capacity only exists there. A region near your users with A1 capacity is ideal.

## 2. Create the virtual machine

Go to **Compute → Instances → Create instance**.

1. **Image:** Canonical Ubuntu 24.04.
2. **Shape:** Ampere → `VM.Standard.A1.Flex`, with 2 OCPUs and 12 GB of memory.
3. **SSH keys:** upload your public key, or let Oracle generate a pair and download the private key.
4. **Boot volume:** the default (about 47 GB) is plenty.
5. Create the instance and note its **public IP address**.

If you see "Out of capacity", try another availability domain in the same region, or try again later. A1 capacity comes and goes.

## 3. Open ports 80 and 443

Oracle blocks everything except SSH at the network level.

1. Open the instance's page, then its **subnet**, then the subnet's **Security List**.
2. Add **Ingress Rules** with source `0.0.0.0/0`:
   - TCP, destination port `80`
   - TCP, destination port `443`

The host firewall inside the VM is handled by the install script.

## 4. Get a free hostname

1. Sign in at [duckdns.org](https://www.duckdns.org/).
2. Create a subdomain, for example `acme-support` → `acme-support.duckdns.org`.
3. Set its IP to the VM's public IP.

DuckDNS hostnames get their own Let's Encrypt certificates. Hostnames that only encode an IP address (sslip.io, nip.io) share one certificate rate limit among all their users and often fail.

Using a domain you already own instead? Add an `A` record pointing at the VM's IP.

## 5. Optional: a Gemini API key

Without a key, Omni.io runs with the offline demo provider. Answers are extractive and no AI is involved.

For real answers, create a key at [Google AI Studio](https://aistudio.google.com/apikey). Its free tier is rate-limited, and you can see your project's current limits in AI Studio.

## 6. Install

SSH into the VM, then:

```sh
ssh ubuntu@<public-ip>
curl -fsSL https://raw.githubusercontent.com/JawadulHadi/omni-io/main/deploy/install.sh \
  | sudo bash -s -- --domain acme-support.duckdns.org
```

The script:
- asks for the Gemini key (press Enter to skip);
- installs Docker and opens the host firewall;
- writes `/opt/omni-io/deploy/.env` with fresh secrets;
- builds and starts everything, which takes about 10 minutes on the ARM VM;
- checks that HTTPS works.

It's safe to run again; that is also how you upgrade.

## 7. Create your account, then close sign-up

1. Open `https://<your hostname>` and create your account. You become the owner of its workspace.
2. Make the instance invite-only:

   ```sh
   sudo sed -i 's/^ALLOW_SIGNUP=.*/ALLOW_SIGNUP=false/' /opt/omni-io/deploy/.env
   cd /opt/omni-io/deploy && sudo docker compose up -d
   ```

3. Invite teammates from **Members → Invite someone**.

## Running it

| Task | Command (in `/opt/omni-io/deploy`) |
| --- | --- |
| Upgrade | Re-run the install command |
| Logs | `sudo docker compose logs -f api worker` |
| Status | `sudo docker compose ps` and `curl https://<host>/health` |
| Back up the database | `sudo docker compose exec -T postgres pg_dump -U omniio omniio \| gzip > omniio-$(date +%F).sql.gz` |
| Change settings | Edit `.env`, then `sudo docker compose up -d` |

Copy backups off the VM: everything lives on that one machine.

## Things to know

- **Idle reclamation.** Oracle may reclaim Always Free instances it considers idle: over 7 days, CPU, network *and* memory use all below 20% (memory only for A1). A quiet, low-traffic deployment can meet that. Keep backups, and check the instance's state now and then.
- **Free-tier limits change.** Oracle cut the A1 allowance from 4 OCPUs and 24 GB to 2 and 12 in June 2026 without much notice. Re-check [Oracle's Always Free page](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm) if something stops working.
- **One machine.** This setup has no redundancy. For real customers, add regular off-machine backups at the very least.
