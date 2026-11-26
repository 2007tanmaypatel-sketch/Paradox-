const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const {
  createDefaultRateCard,
  calculateEntryPricing,
  normalizeRateCard
} = require('./pricing');

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createSeedStore() {
  const rateCard = createDefaultRateCard();
  const today = getTodayIsoDate();

  const starterInputs = [
    {
      farmerId: 'F-101',
      farmerName: 'Ramesh Patel',
      date: today,
      shift: 'Morning',
      quantity: 14.5,
      fat: 4.5,
      snf: 8.5
    },
    {
      farmerId: 'F-102',
      farmerName: 'Sita Devi',
      date: today,
      shift: 'Morning',
      quantity: 24.0,
      fat: 5.5,
      snf: 9.0
    },
    {
      farmerId: 'F-103',
      farmerName: 'Mahesh Yadav',
      date: today,
      shift: 'Evening',
      quantity: 42.5,
      fat: 6.0,
      snf: 9.0
    }
  ];

  const entries = starterInputs.map((item, idx) => {
    const pricing = calculateEntryPricing(rateCard, item);
    return {
      id: `ENT-${1001 + idx}`,
      farmerId: item.farmerId,
      farmerName: item.farmerName,
      date: item.date,
      shift: item.shift,
      ...pricing,
      createdAt: new Date(Date.now() - (starterInputs.length - idx) * 60000).toISOString()
    };
  });

  return { rateCard, entries };
}

class DairyStore {
  constructor(dataFilePath = path.join(__dirname, '..', 'data', 'store.json')) {
    this.dataFilePath = dataFilePath;
    this.writeQueue = Promise.resolve();
  }

  async ensureInitialized() {
    const dir = path.dirname(this.dataFilePath);
    await fsp.mkdir(dir, { recursive: true });
    if (!fs.existsSync(this.dataFilePath)) {
      const seed = createSeedStore();
      await fsp.writeFile(this.dataFilePath, JSON.stringify(seed, null, 2), 'utf8');
    }
  }

  async readData() {
    await this.ensureInitialized();
    const raw = await fsp.readFile(this.dataFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      rateCard: parsed.rateCard || createDefaultRateCard(),
      entries: Array.isArray(parsed.entries) ? parsed.entries : []
    };
  }

  async writeData(data) {
    await this.ensureInitialized();
    const tmpPath = `${this.dataFilePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmpPath, this.dataFilePath);
  }

  enqueue(task) {
    const next = this.writeQueue.then(task);
    this.writeQueue = next.catch(() => {});
    return next;
  }

  async getRateCard() {
    const data = await this.readData();
    return data.rateCard;
  }

  async updateRateCard(payload) {
    return this.enqueue(async () => {
      const normalized = normalizeRateCard(payload);
      const data = await this.readData();
      data.rateCard = normalized;
      await this.writeData(data);
      return normalized;
    });
  }

  async resetRateCard() {
    return this.enqueue(async () => {
      const data = await this.readData();
      data.rateCard = createDefaultRateCard();
      await this.writeData(data);
      return data.rateCard;
    });
  }

  async listEntries({ date, farmerId, from, to } = {}) {
    const data = await this.readData();
    let results = data.entries;

    if (date) {
      results = results.filter((e) => e.date === date);
    }
    if (from) {
      results = results.filter((e) => e.date >= from);
    }
    if (to) {
      results = results.filter((e) => e.date <= to);
    }
    if (farmerId) {
      const target = String(farmerId).trim().toUpperCase();
      results = results.filter((e) => String(e.farmerId).toUpperCase() === target);
    }

    return [...results].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }

  async getEntryById(id) {
    const data = await this.readData();
    return data.entries.find((e) => e.id === id) || null;
  }

  async listFarmers() {
    const data = await this.readData();
    const map = new Map();
    for (const entry of data.entries) {
      const key = String(entry.farmerId).toUpperCase();
      if (!map.has(key)) {
        map.set(key, {
          farmerId: entry.farmerId,
          farmerName: entry.farmerName
        });
      }
    }
    return [...map.values()].sort((a, b) => a.farmerId.localeCompare(b.farmerId));
  }

  async addEntry(input) {
    return this.enqueue(async () => {
      const farmerId = String(input.farmerId || '').trim().toUpperCase();
      const farmerName = String(input.farmerName || '').trim();
      const date = String(input.date || getTodayIsoDate()).trim();
      const shift = input.shift === 'Evening' ? 'Evening' : 'Morning';

      if (!farmerId) {
        throw new Error('Farmer ID is required.');
      }
      if (!farmerName) {
        throw new Error('Farmer Name is required.');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Date must be in YYYY-MM-DD format.');
      }

      const data = await this.readData();
      const pricing = calculateEntryPricing(data.rateCard, {
        quantity: input.quantity,
        fat: input.fat,
        snf: input.snf
      });

      const entry = {
        id: `ENT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        farmerId,
        farmerName,
        date,
        shift,
        ...pricing,
        createdAt: new Date().toISOString()
      };

      data.entries.push(entry);
      await this.writeData(data);
      return entry;
    });
  }

  async deleteEntry(id) {
    return this.enqueue(async () => {
      const data = await this.readData();
      const idx = data.entries.findIndex((e) => e.id === id);
      if (idx === -1) {
        return false;
      }
      data.entries.splice(idx, 1);
      await this.writeData(data);
      return true;
    });
  }
}

module.exports = {
  DairyStore,
  getTodayIsoDate
};
