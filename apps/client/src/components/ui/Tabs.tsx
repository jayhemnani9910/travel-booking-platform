import React, { useState } from 'react';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  onChange?: (tabId: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, defaultTab, onChange }) => {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    onChange?.(tabId);
  };

  const activeTabContent = tabs.find((tab) => tab.id === activeTab)?.content;

  return (
    <div className="w-full">
      {/* Tab Headers */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8 overflow-x-auto" aria-label="Tabs">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`
                  flex items-center py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors
                  ${isActive
                    ? 'border-brand text-brand'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                {tab.icon && <span className="mr-2">{tab.icon}</span>}
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="py-6">
        {activeTabContent}
      </div>
    </div>
  );
};
